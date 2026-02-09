/**
 * Backend Server - Express server with API routes
 *
 * Features:
 * - REST API for runs management
 * - SSE event streaming
 * - CORS support
 * - Request logging middleware
 * - Error handling middleware
 * - Graceful shutdown
 */

import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createRunsRouter } from './api/runs.js';
import { RunQueue } from './queue/run-queue.js';
import { SSEManager } from './api/sse.js';
import { AgentError } from '../utils/errors.js';
import type { LLMConfig } from '../types/agent.js';
import { logger } from '../utils/logger.js';
import type { ErrorResponse } from '../types/api.js';
import type { EmbeddingConfig } from '../types/embedding.js';
import { createEmbeddingProvider } from './store/embedding-provider.js';
import { CheckpointService, createRuntimeExecutor, EventService, MemoryService, RunRepository } from './runtime/index.js';
import { closeSharedPostgresPool, getPostgresPool, runPostgresMigrations } from './db/index.js';

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  baseDir: string;
  corsOrigins: string | string[];
  defaultModelConfig?: LLMConfig;
  maxSteps?: number;
  workDir?: string;
  databaseUrl?: string;
  embeddingConfig?: EmbeddingConfig;
  mcp?: {
    enabled: boolean;
    pythonPath?: string;
    serverModule?: string;
    cwd?: string;
    timeoutMs?: number;
  };
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  baseDir: 'data',
  corsOrigins: '*',
};

/**
 * Create and configure the Express application
 */
export function createApp(config: Partial<ServerConfig> = {}): {
  app: Express;
  runQueue: RunQueue;
  sseManager: SSEManager;
  dbReady: Promise<void>;
} {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const app = express();

  // Create shared instances
  const runQueue = new RunQueue();
  const sseManager = new SSEManager();

  const pool = getPostgresPool(
    finalConfig.databaseUrl ? { connectionString: finalConfig.databaseUrl } : {}
  );
  const dbReady = runPostgresMigrations(pool);
  const runRepository = new RunRepository(pool);
  const eventService = new EventService(runRepository);
  const checkpointService = new CheckpointService(runRepository);
  const requestedEmbedding = finalConfig.embeddingConfig ?? {
    provider: 'hash',
    dimension: 256,
    alpha: 0.6,
  };
  if (requestedEmbedding.dimension !== 256) {
    logger.warn('Embedding dimension overridden to 256 to match pgvector schema', {
      requested: requestedEmbedding.dimension,
    });
  }
  const embeddingProvider = createEmbeddingProvider({
    ...requestedEmbedding,
    dimension: 256,
  });
  const memoryService = new MemoryService(pool, embeddingProvider);

  // Set up runtime executor for the run queue
  const runtimeExecutor = createRuntimeExecutor({
    runRepository,
    eventService,
    checkpointService,
    memoryService,
    sseManager,
    maxSteps: finalConfig.maxSteps ?? 10,
    defaultModelConfig: finalConfig.defaultModelConfig ?? {
      provider: 'mock',
      model: 'mock-model',
      temperature: 0.7,
      maxTokens: 2000,
    },
    workDir: finalConfig.workDir ?? `${finalConfig.baseDir}/workspace`,
    ...(finalConfig.mcp ? { mcp: finalConfig.mcp } : {}),
  });
  runQueue.setExecutor(runtimeExecutor);

  // Middleware: CORS
  app.use(
    cors({
      origin: finalConfig.corsOrigins,
      credentials: true,
    })
  );

  // Middleware: JSON body parser
  app.use(express.json());

  // Middleware: Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.info('Request received', {
      method: req.method,
      path: req.path,
      query: req.query,
    });
    next();
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      queue: {
        length: runQueue.getQueueLength(),
        processing: runQueue.isProcessing(),
      },
      sse: {
        clients: sseManager.getClientCount(),
      },
    });
  });

  // API routes
  const runsRouter = createRunsRouter({
    runQueue,
    sseManager,
    runRepository,
    eventService,
  });
  app.use('/api', runsRouter);

  // Error handling middleware
  app.use(errorHandler);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    const response: ErrorResponse = {
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not found',
      },
    };
    res.status(404).json(response);
  });

  return { app, runQueue, sseManager, dbReady };
}

/**
 * Error handling middleware
 */
function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Request error', {
    error: err.message,
    stack: err.stack,
  });

  if (err instanceof AgentError) {
    const response: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Generic error response
  const response: ErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
    },
  };
  res.status(500).json(response);
}

/**
 * Server instance wrapper for graceful shutdown
 */
export interface ServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create and start the server
 */
export function createServer(config: Partial<ServerConfig> = {}): ServerInstance {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const { app, runQueue, sseManager, dbReady } = createApp(config);

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    async start(): Promise<void> {
      await dbReady;
      return new Promise((resolve) => {
        // Start SSE heartbeat
        sseManager.startHeartbeat();

        server = app.listen(finalConfig.port, () => {
          logger.info('Server started', {
            port: finalConfig.port,
            baseDir: finalConfig.baseDir,
          });
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        // Stop SSE manager
        sseManager.shutdown();

        // Clear queue
        runQueue.clearCompleted();

        if (server) {
          server.close((err) => {
            if (err) {
              reject(err);
            } else {
              void closeSharedPostgresPool()
                .then(() => {
                  logger.info('Server stopped');
                  resolve();
                })
                .catch(reject);
            }
          });
        } else {
          void closeSharedPostgresPool()
            .then(resolve)
            .catch(reject);
        }
      });
    },
  };
}

// Main entry point when run directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const port = parseInt(process.env['PORT'] ?? '3000');
  const baseDir = process.env['DATA_DIR'] ?? 'data';
  const databaseUrl = process.env['DATABASE_URL'];

  const server = createServer({
    port,
    baseDir,
    ...(databaseUrl ? { databaseUrl } : {}),
  });

  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    void server.stop().then(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    void server.stop().then(() => process.exit(0));
  });

  void server.start();
}
