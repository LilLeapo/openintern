/**
 * Runs API - Postgres-backed run lifecycle endpoints
 *
 * Endpoints:
 * - POST /api/runs
 * - GET /api/runs/:run_id
 * - GET /api/sessions/:session_key/runs
 * - GET /api/runs/:run_id/events?cursor&limit
 * - GET /api/runs/:run_id/stream
 * - GET /api/runs/:run_id/children
 * - POST /api/runs/:run_id/inject
 * - POST /api/runs/:run_id/cancel
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  CreateRunRequestSchema,
  type CreateRunResponse,
  type ErrorResponse,
  type GetRunEventsResponse,
  type ListRunsResponse,
  type QueuedRun,
} from '../../types/api.js';
import type { RunMeta } from '../../types/run.js';
import { generateRunId } from '../../utils/ids.js';
import { AgentError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { RunQueue } from '../queue/run-queue.js';
import { SSEManager } from './sse.js';
import { EventService } from '../runtime/event-service.js';
import { resolveRequestScope } from '../runtime/request-scope.js';
import { RunRepository } from '../runtime/run-repository.js';

export interface RunsRouterConfig {
  runQueue: RunQueue;
  sseManager: SSEManager;
  runRepository: RunRepository;
  eventService: EventService;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  field: string,
  min: number,
  max: number
): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new ValidationError(`${field} must be between ${min} and ${max}`, field);
  }
  return parsed;
}

function mapRunToMeta(
  run: Awaited<ReturnType<RunRepository['requireRun']>>,
  counters: { eventCount: number; toolCalls: number }
): RunMeta {
  const startedAt = run.startedAt ?? run.createdAt;
  const endedAt = run.endedAt;
  const durationMs =
    endedAt && startedAt ? new Date(endedAt).getTime() - new Date(startedAt).getTime() : null;
  return {
    run_id: run.id,
    session_key: run.sessionKey,
    status: run.status,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    event_count: counters.eventCount,
    tool_call_count: counters.toolCalls,
    parent_run_id: run.parentRunId ?? null,
  };
}

function sendError(res: Response, error: ErrorResponse, status: number): void {
  res.status(status).json(error);
}

export function createRunsRouter(config: RunsRouterConfig): Router {
  const router = Router();
  const { runQueue, sseManager, runRepository, eventService } = config;

  router.post('/runs', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const parseResult = CreateRunRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          const firstError = parseResult.error.errors[0];
          throw new ValidationError(
            firstError?.message ?? 'Invalid request',
            firstError?.path.join('.') ?? 'body'
          );
        }

        const scope = resolveRequestScope(req);
        const runId = generateRunId();
        const sessionKey = parseResult.data.session_key ?? 's_default';
        const agentId = parseResult.data.agent_id ?? 'main';

        const created = await runRepository.createRun({
          id: runId,
          scope,
          sessionKey,
          input: parseResult.data.input,
          agentId,
          llmConfig: parseResult.data.llm_config ?? null,
        });

        const queuedRun: QueuedRun = {
          run_id: created.id,
          org_id: created.orgId,
          user_id: created.userId,
          ...(created.projectId ? { project_id: created.projectId } : {}),
          session_key: created.sessionKey,
          input: created.input,
          agent_id: created.agentId,
          created_at: created.createdAt,
          status: 'pending',
          llm_config: created.llmConfig ?? undefined,
        };
        runQueue.enqueue(queuedRun);

        const response: CreateRunResponse = {
          run_id: created.id,
          status: created.status,
          created_at: created.createdAt,
        };

        res.status(201).json(response);
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get('/runs/:run_id', (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const { run_id: runId } = req.params;
        if (!runId) {
          throw new ValidationError('run_id is required', 'run_id');
        }
        const scope = resolveRequestScope(req);
        const run = await runRepository.requireRun(runId, scope);
        const counters = await runRepository.countEventsAndTools(runId);
        res.json(mapRunToMeta(run, counters));
      } catch (error) {
        next(error);
      }
    })();
  });

  router.get(
    '/sessions/:session_key/runs',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { session_key: sessionKey } = req.params;
          if (!sessionKey) {
            throw new ValidationError('session_key is required', 'session_key');
          }
          const scope = resolveRequestScope(req);
          const page = parsePositiveInt(req.query['page'] as string | undefined, 1, 'page', 1, 10_000);
          const limit = parsePositiveInt(
            req.query['limit'] as string | undefined,
            20,
            'limit',
            1,
            100
          );
          const result = await runRepository.listRunsBySession(scope, sessionKey, page, limit);
          const response: ListRunsResponse = {
            runs: result.runs,
            total: result.total,
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

  router.get(
    '/runs/:run_id/events',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id: runId } = req.params;
          if (!runId) {
            throw new ValidationError('run_id is required', 'run_id');
          }

          const scope = resolveRequestScope(req);
          const cursor = req.query['cursor'] as string | undefined;
          const limit = parsePositiveInt(
            req.query['limit'] as string | undefined,
            200,
            'limit',
            1,
            1000
          );
          const typeFilter = req.query['type'] as string | undefined;

          const page = await eventService.list(runId, scope, cursor, limit);
          const events = typeFilter
            ? page.events.filter((event) => event.type === typeFilter)
            : page.events;
          const response: GetRunEventsResponse = {
            events,
            total: events.length,
            next_cursor: page.next_cursor,
          };
          res.json(response);
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  router.get(
    '/runs/:run_id/stream',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id: runId } = req.params;
          if (!runId) {
            throw new ValidationError('run_id is required', 'run_id');
          }
          const scope = resolveRequestScope(req);
          await runRepository.requireRun(runId, scope);

          const clientId = sseManager.addClient(runId, res);

          const cursor = req.query['cursor'] as string | undefined;
          if (cursor) {
            const page = await eventService.list(runId, scope, cursor, 500);
            for (const event of page.events) {
              res.write(`id: ${event.span_id}\n`);
              res.write('event: run.event\n');
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
          }

          req.on('close', () => {
            sseManager.removeClient(clientId);
          });
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  router.get(
    '/runs/:run_id/children',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id: runId } = req.params;
          if (!runId) {
            throw new ValidationError('run_id is required', 'run_id');
          }
          const scope = resolveRequestScope(req);
          await runRepository.requireRun(runId, scope);
          const children = await runRepository.getChildRuns(runId);
          res.json({ children });
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  router.post(
    '/runs/:run_id/inject',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id: runId } = req.params;
          if (!runId) {
            throw new ValidationError('run_id is required', 'run_id');
          }
          const body = req.body as { message?: string; role?: string };
          if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
            throw new ValidationError('message is required', 'message');
          }

          const scope = resolveRequestScope(req);
          const run = await runRepository.requireRun(runId, scope);

          if (run.status !== 'running' && run.status !== 'waiting') {
            throw new AgentError(
              'Can only inject messages into running or waiting runs',
              'RUN_NOT_INJECTABLE',
              400
            );
          }

          const event = {
            v: 1 as const,
            ts: new Date().toISOString(),
            session_key: run.sessionKey,
            run_id: run.id,
            agent_id: 'user',
            step_id: `step_inject_${Date.now()}`,
            span_id: `span_inject_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            parent_span_id: null,
            type: 'user.injected' as const,
            payload: {
              message: body.message.trim(),
              role: body.role ?? 'user',
            },
            redaction: { contains_secrets: false },
          };

          // Write event and broadcast via SSE
          await eventService.write(event as unknown as import('../../types/events.js').Event);
          sseManager.broadcastToRun(runId, event as unknown as import('../../types/events.js').Event);

          logger.info('User message injected into run', { runId, role: body.role ?? 'user' });
          res.json({ success: true, run_id: runId });
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  router.post(
    '/runs/:run_id/cancel',
    (req: Request, res: Response, next: NextFunction) => {
      void (async () => {
        try {
          const { run_id: runId } = req.params;
          if (!runId) {
            throw new ValidationError('run_id is required', 'run_id');
          }
          const scope = resolveRequestScope(req);
          const run = await runRepository.requireRun(runId, scope);

          if (run.status === 'pending') {
            const removed = runQueue.cancel(runId);
            if (!removed) {
              const queueStatus = runQueue.getStatus(runId);
              if (queueStatus === 'running') {
                throw new AgentError('Cannot cancel a running run', 'RUN_NOT_CANCELLABLE', 400);
              }
            }
            await runRepository.setRunCancelled(runId);
            res.json({ success: true, run_id: runId });
            return;
          }

          if (run.status === 'running') {
            const cancelled = runQueue.cancel(runId);
            if (!cancelled) {
              throw new AgentError('Run is no longer cancellable', 'RUN_NOT_CANCELLABLE', 400);
            }
            await runRepository.setRunCancelled(runId);
            res.json({ success: true, run_id: runId });
            return;
          }
          if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
            throw new AgentError('Run has already finished', 'RUN_ALREADY_FINISHED', 400);
          }

          throw new NotFoundError('Run', runId);
        } catch (error) {
          next(error);
        }
      })();
    }
  );

  router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof NotFoundError) {
      sendError(
        res,
        {
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        },
        err.statusCode
      );
      return;
    }
    next(err);
  });

  logger.info('Runs router initialized (postgres mode)');
  return router;
}
