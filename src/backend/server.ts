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
import { createAgentExecutor } from './agent/executor.js';
import { AgentError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ErrorResponse } from '../types/api.js';

/**
 * Server configuration
 */
export interface ServerConfig {
  port: number;
  baseDir: string;
  corsOrigins: string | string[];
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
} {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const app = express();

  // Create shared instances
  const runQueue = new RunQueue();
  const sseManager = new SSEManager();

  // Set up agent executor for the run queue
  const agentExecutor = createAgentExecutor({
    baseDir: finalConfig.baseDir,
    sseManager,
    maxSteps: 10,
  });
  runQueue.setExecutor(agentExecutor);

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
    baseDir: finalConfig.baseDir,
    runQueue,
    sseManager,
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

  return { app, runQueue, sseManager };
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
  const { app, runQueue, sseManager } = createApp(config);

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    async start(): Promise<void> {
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
              logger.info('Server stopped');
              resolve();
            }
          });
        } else {
          resolve();
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

  const server = createServer({ port, baseDir });

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
