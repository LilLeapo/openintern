/**
 * Runs API - REST endpoints for run management
 *
 * Endpoints:
 * - POST /api/runs - Create a new run
 * - GET /api/runs/:run_id - Get run details
 * - GET /api/sessions/:session_key/runs - List runs for a session
 * - GET /api/runs/:run_id/events - Get run events
 * - GET /api/runs/:run_id/stream - SSE event stream
 * - POST /api/runs/:run_id/cancel - Cancel a run
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  CreateRunRequestSchema,
  type CreateRunResponse,
  type ListRunsResponse,
  type GetRunEventsResponse,
  type QueuedRun,
} from '../../types/api.js';
import type { RunMeta } from '../../types/run.js';
import { EventStore } from '../store/event-store.js';
import { ProjectionStore } from '../store/projection-store.js';
import { generateRunId } from '../../utils/ids.js';
import { NotFoundError, ValidationError, AgentError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { RunQueue } from '../queue/run-queue.js';
import { SSEManager } from './sse.js';

/**
 * Runs router configuration
 */
export interface RunsRouterConfig {
  baseDir: string;
  runQueue: RunQueue;
  sseManager: SSEManager;
}

/**
 * Create the runs router
 */
export function createRunsRouter(config: RunsRouterConfig): Router {
  const router = Router();
  const { baseDir, runQueue, sseManager } = config;

  /**
   * POST /api/runs - Create a new run
   */
  router.post('/runs', (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate request body
      const parseResult = CreateRunRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        const firstError = parseResult.error.errors[0];
        throw new ValidationError(
          firstError?.message ?? 'Invalid request',
          firstError?.path.join('.') ?? 'body'
        );
      }

      const { session_key, input, agent_id, llm_config } = parseResult.data;
      const runId = generateRunId();
      const createdAt = new Date().toISOString();

      // Create queued run
      const queuedRun: QueuedRun = {
        run_id: runId,
        session_key,
        input,
        agent_id: agent_id ?? 'main',
        created_at: createdAt,
        status: 'pending',
        llm_config,
      };

      // Enqueue the run
      runQueue.enqueue(queuedRun);

      // Return response
      const response: CreateRunResponse = {
        run_id: runId,
        status: 'pending',
        created_at: createdAt,
      };

      logger.info('Run created', { runId, sessionKey: session_key });
      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  });

  /**
   * GET /api/runs/:run_id - Get run details
   */
  router.get('/runs/:run_id', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const { run_id } = req.params;

        if (!run_id) {
          throw new ValidationError('run_id is required', 'run_id');
        }

        // Try to find the run in the queue first
        const queuedRun = runQueue.getRun(run_id);

        // Try to load from projection store
        const runMeta = await findRunMeta(baseDir, run_id);

        if (!runMeta && !queuedRun) {
          throw new NotFoundError('Run', run_id);
        }

        // Merge queue status with stored meta if available
        if (runMeta && queuedRun) {
          runMeta.status = queuedRun.status;
        }

        res.json(runMeta ?? {
          run_id: queuedRun?.run_id,
          session_key: queuedRun?.session_key,
          status: queuedRun?.status,
          started_at: queuedRun?.created_at,
          ended_at: null,
          duration_ms: null,
          event_count: 0,
          tool_call_count: 0,
        });
      } catch (error) {
        next(error);
      }
    })();
  });

  /**
   * GET /api/sessions/:session_key/runs - List runs for a session
   */
  router.get(
    '/sessions/:session_key/runs',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { session_key } = req.params;
          const pageStr = req.query['page'] as string | undefined;
          const limitStr = req.query['limit'] as string | undefined;
          const page = pageStr !== undefined ? parseInt(pageStr) : 1;
          const limit = limitStr !== undefined ? parseInt(limitStr) : 20;

          if (!session_key) {
            throw new ValidationError('session_key is required', 'session_key');
          }

          // Validate pagination
          if (isNaN(page) || page < 1) {
            throw new ValidationError('page must be >= 1', 'page');
          }
          if (isNaN(limit) || limit < 1 || limit > 100) {
            throw new ValidationError('limit must be between 1 and 100', 'limit');
          }

          // List runs from file system
          const runs = await listSessionRuns(baseDir, session_key);

          // Sort by started_at descending
          runs.sort((a, b) =>
            new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
          );

          // Paginate
          const total = runs.length;
          const startIndex = (page - 1) * limit;
          const paginatedRuns = runs.slice(startIndex, startIndex + limit);

          const response: ListRunsResponse = {
            runs: paginatedRuns,
            total,
            page,
            limit,
          };

          res.json(response);
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  /**
   * GET /api/runs/:run_id/events - Get run events
   */
  router.get(
    '/runs/:run_id/events',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id } = req.params;
          const eventType = req.query['type'] as string | undefined;
          const after = req.query['after'] as string | undefined;

          if (!run_id) {
            throw new ValidationError('run_id is required', 'run_id');
          }

          // Find the run's session key
          const runInfo = await findRunInfo(baseDir, run_id);
          if (!runInfo) {
            throw new NotFoundError('Run', run_id);
          }

          const eventStore = new EventStore(
            runInfo.sessionKey,
            run_id,
            baseDir
          );

          // Read and filter events
          let events = await eventStore.readAll();

          // Filter by type if specified
          if (eventType) {
            events = events.filter((e) => e.type === eventType);
          }

          // Filter by timestamp if specified
          if (after) {
            const afterDate = new Date(after);
            events = events.filter((e) => new Date(e.ts) > afterDate);
          }

          const response: GetRunEventsResponse = {
            events,
            total: events.length,
          };

          res.json(response);
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  /**
   * GET /api/runs/:run_id/stream - SSE event stream
   */
  router.get(
    '/runs/:run_id/stream',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { run_id } = req.params;
        const lastEventId = req.headers['last-event-id'] as string | undefined;

        if (!run_id) {
          throw new ValidationError('run_id is required', 'run_id');
        }

        // Add client to SSE manager
        const clientId = sseManager.addClient(run_id, res, lastEventId);

        // Handle client disconnect
        req.on('close', () => {
          sseManager.removeClient(clientId);
        });

        // Keep connection open (don't call res.end())
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/runs/:run_id/cancel - Cancel a run
   */
  router.post(
    '/runs/:run_id/cancel',
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { run_id } = req.params;

        if (!run_id) {
          throw new ValidationError('run_id is required', 'run_id');
        }

        const cancelled = runQueue.cancel(run_id);

        if (!cancelled) {
          // Check if run exists but is not cancellable
          const status = runQueue.getStatus(run_id);
          if (status === 'running') {
            throw new AgentError(
              'Cannot cancel a running run',
              'RUN_NOT_CANCELLABLE',
              400
            );
          }
          if (status === 'completed' || status === 'failed') {
            throw new AgentError(
              'Run has already finished',
              'RUN_ALREADY_FINISHED',
              400
            );
          }
          throw new NotFoundError('Run', run_id);
        }

        logger.info('Run cancelled', { runId: run_id });
        res.json({ success: true, run_id });
      } catch (error) {
        next(error);
      }
    }
  );

  return router;
}

/**
 * Find run metadata by run_id (searches all sessions)
 */
async function findRunMeta(
  baseDir: string,
  runId: string
): Promise<RunMeta | null> {
  const runInfo = await findRunInfo(baseDir, runId);
  if (!runInfo) {
    return null;
  }

  const projectionStore = new ProjectionStore(
    runInfo.sessionKey,
    runId,
    baseDir
  );

  return projectionStore.loadRunMeta();
}

/**
 * Find run info (session key) by run_id
 */
async function findRunInfo(
  baseDir: string,
  runId: string
): Promise<{ sessionKey: string } | null> {
  const sessionsDir = path.join(baseDir, 'sessions');

  try {
    const sessions = await fs.promises.readdir(sessionsDir);

    for (const sessionKey of sessions) {
      const runsDir = path.join(sessionsDir, sessionKey, 'runs');

      try {
        const runs = await fs.promises.readdir(runsDir);
        if (runs.includes(runId)) {
          return { sessionKey };
        }
      } catch {
        // Session has no runs directory
        continue;
      }
    }
  } catch {
    // Sessions directory doesn't exist
    return null;
  }

  return null;
}

/**
 * List all runs for a session
 */
async function listSessionRuns(
  baseDir: string,
  sessionKey: string
): Promise<RunMeta[]> {
  const runsDir = path.join(baseDir, 'sessions', sessionKey, 'runs');
  const runs: RunMeta[] = [];

  try {
    const runIds = await fs.promises.readdir(runsDir);

    for (const runId of runIds) {
      const projectionStore = new ProjectionStore(sessionKey, runId, baseDir);
      const meta = await projectionStore.loadRunMeta();

      if (meta) {
        runs.push(meta);
      }
    }
  } catch {
    // Runs directory doesn't exist - return empty array
  }

  return runs;
}
