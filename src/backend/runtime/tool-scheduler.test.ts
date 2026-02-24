import { describe, expect, it, vi } from 'vitest';
import type { RuntimeToolRouter } from './tool-router.js';
import { RunSuspendedError, ToolCallScheduler } from './tool-scheduler.js';

describe('ToolCallScheduler', () => {
  it('throws RunSuspendedError immediately for requiresApproval tools in checkpoint mode', async () => {
    const scheduler = new ToolCallScheduler();
    const onSuspend = vi.fn(async () => undefined);
    const router = {
      listTools: vi.fn(() => [
        {
          name: 'exec_shell',
          description: 'execute command',
          parameters: {},
          metadata: {
            risk_level: 'high',
            mutating: true,
            supports_parallel: false,
          },
        },
      ]),
      callTool: vi.fn(async () => ({
        success: false,
        error: 'Requires approval',
        duration: 1,
        requiresApproval: true,
        policyReason: 'high-risk execution',
        riskLevel: 'high',
      })),
    } as unknown as RuntimeToolRouter;

    await expect(
      scheduler.executeBatch(
        [
          {
            id: 'tc_approval',
            name: 'exec_shell',
            parameters: { command: 'rm -rf /tmp/test' },
          },
        ],
        router,
        {
          runId: 'run_test',
          sessionKey: 's_test',
          agentId: 'main',
          stepId: 'step_0001',
          rootSpan: 'sp_root',
          onSuspend,
        }
      )
    ).rejects.toBeInstanceOf(RunSuspendedError);

    expect(onSuspend).toHaveBeenCalledTimes(1);
    expect(onSuspend).toHaveBeenCalledWith('high-risk execution');
    expect(scheduler.approvalManager.getPending('tc_approval')).toBeUndefined();
  });
});
