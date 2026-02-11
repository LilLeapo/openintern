import type { ToolCall, ToolResult } from '../../types/agent.js';
import type { Event, EventType } from '../../types/events.js';
import type { RuntimeToolRouter } from './tool-router.js';
import type { AgentContext } from './tool-policy.js';
import { generateSpanId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';

/**
 * Tool metadata used for scheduling decisions.
 */
export interface ToolScheduleMeta {
  mutating: boolean;
  supports_parallel: boolean;
  risk_level: 'low' | 'medium' | 'high';
  timeout_ms?: number;
}

/**
 * Result of a single tool execution within a batch.
 */
export interface ToolExecResult {
  toolCall: ToolCall;
  result: ToolResult;
}

/**
 * Result of executing a full batch of tool calls.
 */
export interface BatchResult {
  batch_id: string;
  results: ToolExecResult[];
  events: Event[];
  duration_ms: number;
}

/** Default concurrency limit for parallel tool execution. */
const DEFAULT_PARALLEL_LIMIT = 8;

/**
 * ToolCallScheduler partitions tool calls by safety (mutating vs read-only)
 * and executes them in parallel or serial groups accordingly.
 *
 * Strategy:
 * - read/inspect tools (mutating=false, risk!=high) → parallel group
 * - write/exec tools (mutating=true or risk=high) → serial group
 * - Serial group always runs after parallel group completes
 */
export class ToolCallScheduler {
  private readonly parallelLimit: number;

  constructor(opts?: { parallelLimit?: number }) {
    this.parallelLimit = opts?.parallelLimit ?? DEFAULT_PARALLEL_LIMIT;
  }

  /**
   * Execute a batch of tool calls with automatic parallel/serial partitioning.
   */
  async executeBatch(
    calls: ToolCall[],
    router: RuntimeToolRouter,
    ctx: {
      runId: string;
      sessionKey: string;
      agentId: string;
      stepId: string;
      rootSpan: string;
      agentContext?: AgentContext;
      abortSignal?: AbortSignal;
    }
  ): Promise<BatchResult> {
    const batchId = `batch_${generateSpanId()}`;
    const started = Date.now();
    const events: Event[] = [];
    const allResults: ToolExecResult[] = [];

    const { parallel, serial } = this.partitionCallsBySafety(calls, router);

    // Emit batch started
    events.push(this.createBatchEvent(ctx, 'tool.batch.started', {
      batch_id: batchId,
      tool_count: calls.length,
      strategy: parallel.length > 0 && serial.length > 0 ? 'parallel' : 'serial',
    }));

    // Execute parallel group first
    if (parallel.length > 0) {
      const pResults = await this.executeParallelGroup(
        parallel, router, ctx
      );
      allResults.push(...pResults.results);
      events.push(...pResults.events);
    }

    // Then execute serial group
    if (serial.length > 0) {
      const sResults = await this.executeSerialGroup(
        serial, router, ctx
      );
      allResults.push(...sResults.results);
      events.push(...sResults.events);
    }

    const duration_ms = Date.now() - started;
    const successCount = allResults.filter((r) => r.result.success).length;

    events.push(this.createBatchEvent(ctx, 'tool.batch.completed', {
      batch_id: batchId,
      tool_count: calls.length,
      success_count: successCount,
      failure_count: calls.length - successCount,
      duration_ms,
    }));

    return { batch_id: batchId, results: allResults, events, duration_ms };
  }

  /**
   * Partition tool calls into parallel-safe and serial-only groups.
   */
  partitionCallsBySafety(
    calls: ToolCall[],
    router: RuntimeToolRouter
  ): { parallel: ToolCall[]; serial: ToolCall[] } {
    const parallel: ToolCall[] = [];
    const serial: ToolCall[] = [];

    for (const call of calls) {
      const meta = this.getToolMeta(call.name, router);
      if (!meta.mutating && meta.supports_parallel && meta.risk_level !== 'high') {
        parallel.push(call);
      } else {
        serial.push(call);
      }
    }

    return { parallel, serial };
  }

  private async executeParallelGroup(
    calls: ToolCall[],
    router: RuntimeToolRouter,
    ctx: {
      stepId: string;
      rootSpan: string;
      runId: string;
      sessionKey: string;
      agentId: string;
      agentContext?: AgentContext;
      abortSignal?: AbortSignal;
    }
  ): Promise<{ results: ToolExecResult[]; events: Event[] }> {
    const events: Event[] = [];
    const results: ToolExecResult[] = [];

    // Execute in chunks respecting parallelLimit
    for (let i = 0; i < calls.length; i += this.parallelLimit) {
      if (ctx.abortSignal?.aborted) break;

      const chunk = calls.slice(i, i + this.parallelLimit);
      const promises = chunk.map(async (call) => {
        events.push(this.createToolEvent(ctx, 'tool.called', {
          toolName: call.name,
          args: call.parameters,
        }));

        const result = await router.callTool(
          call.name, call.parameters, ctx.agentContext
        );

        events.push(this.createToolResultEvent(ctx, call.name, result));
        return { toolCall: call, result };
      });

      const chunkResults = await Promise.allSettled(promises);
      for (const settled of chunkResults) {
        if (settled.status === 'fulfilled') {
          results.push(settled.value);
        } else {
          logger.error('Parallel tool execution failed', {
            error: settled.reason,
          });
        }
      }
    }

    return { results, events };
  }

  private async executeSerialGroup(
    calls: ToolCall[],
    router: RuntimeToolRouter,
    ctx: {
      stepId: string;
      rootSpan: string;
      runId: string;
      sessionKey: string;
      agentId: string;
      agentContext?: AgentContext;
      abortSignal?: AbortSignal;
    }
  ): Promise<{ results: ToolExecResult[]; events: Event[] }> {
    const events: Event[] = [];
    const results: ToolExecResult[] = [];

    for (const call of calls) {
      if (ctx.abortSignal?.aborted) break;

      events.push(this.createToolEvent(ctx, 'tool.called', {
        toolName: call.name,
        args: call.parameters,
      }));

      const result = await router.callTool(
        call.name, call.parameters, ctx.agentContext
      );

      events.push(this.createToolResultEvent(ctx, call.name, result));
      results.push({ toolCall: call, result });
    }

    return { results, events };
  }

  private getToolMeta(toolName: string, router: RuntimeToolRouter): ToolScheduleMeta {
    const tools = router.listTools();
    const def = tools.find((t) => t.name === toolName);
    if (def?.metadata) {
      return {
        mutating: def.metadata.mutating ?? false,
        supports_parallel: def.metadata.supports_parallel ?? true,
        risk_level: def.metadata.risk_level ?? 'low',
        timeout_ms: def.metadata.timeout_ms,
      };
    }
    // Default: read-only tools are safe for parallel
    const isWrite = /^(write_|exec_|apply_|memory_write)/.test(toolName);
    return {
      mutating: isWrite,
      supports_parallel: !isWrite,
      risk_level: 'low',
      timeout_ms: undefined,
    };
  }

  private createBatchEvent(
    ctx: { runId: string; sessionKey: string; agentId: string; stepId: string; rootSpan: string },
    type: 'tool.batch.started' | 'tool.batch.completed',
    payload: Record<string, unknown>
  ): Event {
    return {
      v: 1,
      ts: new Date().toISOString(),
      session_key: ctx.sessionKey,
      run_id: ctx.runId,
      agent_id: ctx.agentId,
      step_id: ctx.stepId,
      span_id: generateSpanId(),
      parent_span_id: ctx.rootSpan,
      redaction: { contains_secrets: false },
      type,
      payload,
    } as Event;
  }

  private createToolEvent(
    ctx: { runId: string; sessionKey: string; agentId: string; stepId: string; rootSpan: string },
    type: 'tool.called',
    payload: { toolName: string; args: Record<string, unknown> }
  ): Event {
    return {
      v: 1,
      ts: new Date().toISOString(),
      session_key: ctx.sessionKey,
      run_id: ctx.runId,
      agent_id: ctx.agentId,
      step_id: ctx.stepId,
      span_id: generateSpanId(),
      parent_span_id: ctx.rootSpan,
      redaction: { contains_secrets: false },
      type,
      payload,
    } as Event;
  }

  private createToolResultEvent(
    ctx: { runId: string; sessionKey: string; agentId: string; stepId: string; rootSpan: string },
    toolName: string,
    result: ToolResult
  ): Event {
    return {
      v: 1,
      ts: new Date().toISOString(),
      session_key: ctx.sessionKey,
      run_id: ctx.runId,
      agent_id: ctx.agentId,
      step_id: ctx.stepId,
      span_id: generateSpanId(),
      parent_span_id: ctx.rootSpan,
      redaction: { contains_secrets: false },
      type: 'tool.result',
      payload: {
        toolName,
        result: result.result,
        isError: !result.success,
        ...(result.success ? {} : {
          error: { code: 'TOOL_ERROR', message: result.error ?? 'Unknown error' },
        }),
      },
    } as Event;
  }
}
