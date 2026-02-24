import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { RunRecord } from '../runtime/models.js';
import { createRunsRouter } from './runs.js';

function suspendedRun(runId: string): RunRecord {
  return {
    id: runId,
    orgId: 'org_test',
    userId: 'user_test',
    projectId: null,
    groupId: null,
    sessionKey: 's_test',
    input: 'resume me',
    status: 'suspended',
    agentId: 'dispatcher',
    llmConfig: null,
    result: null,
    error: null,
    parentRunId: null,
    delegatedPermissions: null,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    cancelledAt: null,
    suspendedAt: new Date().toISOString(),
    suspendReason: 'approval required',
  };
}

function createTestApp(config: {
  runRepository: {
    requireRun: (...args: unknown[]) => Promise<RunRecord>;
    setRunResumedFromSuspension: (...args: unknown[]) => Promise<void>;
  };
  runQueue: { enqueue: (...args: unknown[]) => void };
  checkpointService: { appendToolResults: (...args: unknown[]) => Promise<void> };
}): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', createRunsRouter({
    runQueue: config.runQueue as never,
    sseManager: {
      getOrCreateClient: vi.fn(),
      removeClient: vi.fn(),
      broadcastToRun: vi.fn(),
      shutdown: vi.fn(),
    } as never,
    runRepository: config.runRepository as never,
    eventService: {
      write: vi.fn(async () => undefined),
      writeBatch: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ events: [], next_cursor: null })),
    } as never,
    checkpointService: config.checkpointService as never,
  }));
  app.use((err: Error & { code?: string; statusCode?: number; details?: unknown }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode ?? 500).json({
      error: {
        code: err.code ?? 'INTERNAL_ERROR',
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  });
  return app;
}

describe('Runs API approval routes (unit)', () => {
  it('approves suspended run by injecting tool-result, setting pending status, and re-enqueuing', async () => {
    const runRepository = {
      requireRun: vi.fn(async () => suspendedRun('run_suspend_1')),
      setRunResumedFromSuspension: vi.fn(async () => undefined),
    };
    const runQueue = {
      enqueue: vi.fn(),
    };
    const checkpointService = {
      appendToolResults: vi.fn(async () => undefined),
    };
    const app = createTestApp({ runRepository, runQueue, checkpointService });

    const response = await request(app)
      .post('/api/runs/run_suspend_1/approve')
      .set('x-org-id', 'org_test')
      .set('x-user-id', 'user_test')
      .send({ tool_call_id: 'tc_approve_1' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      run_id: 'run_suspend_1',
      tool_call_id: 'tc_approve_1',
    });
    expect(checkpointService.appendToolResults).toHaveBeenCalledTimes(1);
    expect(checkpointService.appendToolResults).toHaveBeenCalledWith(
      'run_suspend_1',
      'dispatcher',
      [
        {
          role: 'tool',
          toolCallId: 'tc_approve_1',
          content: JSON.stringify({
            approved: true,
            tool_call_id: 'tc_approve_1',
          }),
        },
      ]
    );
    expect(runRepository.setRunResumedFromSuspension).toHaveBeenCalledWith('run_suspend_1');
    expect(runQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(runQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      run_id: 'run_suspend_1',
      status: 'pending',
      agent_id: 'dispatcher',
    }));
  });
});
