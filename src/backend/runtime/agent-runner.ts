import type { LLMConfig, Message, ToolCall } from '../../types/agent.js';
import type { Event, EventType } from '../../types/events.js';
import type { ScopeContext } from './scope.js';
import { createLLMClient } from '../agent/llm-client.js';
import { generateSpanId, generateStepId } from '../../utils/ids.js';
import { CheckpointService } from './checkpoint-service.js';
import { MemoryService } from './memory-service.js';
import { RuntimeToolRouter } from './tool-router.js';
import type { ToolResult } from '../../types/agent.js';
import type { AgentContext } from './tool-policy.js';

export interface RunnerContext {
  runId: string;
  sessionKey: string;
  scope: ScopeContext;
  agentId: string;
  groupId?: string;
  agentInstanceId?: string;
}

export interface RunnerResult {
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
  steps: number;
}

export interface AgentRunner {
  run(input: string, ctx: RunnerContext): AsyncGenerator<Event, RunnerResult, void>;
}

export interface SingleAgentRunnerConfig {
  maxSteps: number;
  modelConfig: LLMConfig;
  checkpointService: CheckpointService;
  memoryService: MemoryService;
  toolRouter: RuntimeToolRouter;
  /** Custom system prompt (overrides default) */
  systemPrompt?: string;
  /** Agent context for tool policy checks (multi-role mode) */
  agentContext?: AgentContext;
}

const SYSTEM_PROMPT = `You are a task-oriented coding assistant.
You can call tools.
Memory workflow rule:
1) Use memory_search for recall.
2) If needed, use memory_get for full text.
3) Use memory_write to store durable insights.
Keep answers concise and actionable.`;

export class SingleAgentRunner implements AgentRunner {
  private readonly maxSteps: number;

  constructor(private readonly config: SingleAgentRunnerConfig) {
    this.maxSteps = config.maxSteps;
  }

  async *run(input: string, ctx: RunnerContext): AsyncGenerator<Event, RunnerResult, void> {
    const messages: Message[] = [{ role: 'user', content: input }];
    const llmClient = createLLMClient(this.config.modelConfig);
    const rootSpan = generateSpanId();
    const startedAt = Date.now();
    let lastToolResult: unknown = null;
    let steps = 0;

    yield this.createEvent(ctx, generateStepId(0), rootSpan, 'run.started', {
      input,
    });

    try {
      for (let step = 1; step <= this.maxSteps; step++) {
        steps = step;
        const stepId = generateStepId(step);
        const stepStart = Date.now();

        yield this.createEvent(ctx, stepId, rootSpan, 'step.started', {
          stepNumber: step,
        });

        const memoryQuery = this.buildMemoryQuery(messages);
        const memoryScope = {
          org_id: ctx.scope.orgId,
          user_id: ctx.scope.userId,
          ...(ctx.scope.projectId ? { project_id: ctx.scope.projectId } : {}),
        };
        const memoryHits = ctx.groupId
          ? await this.config.memoryService.memory_search_tiered({
              query: memoryQuery,
              scope: memoryScope,
              top_k: 6,
              group_id: ctx.groupId,
              agent_instance_id: ctx.agentInstanceId,
            })
          : await this.config.memoryService.memory_search({
              query: memoryQuery,
              scope: memoryScope,
              top_k: 6,
            });
        const contextMessages = this.buildModelMessages(messages, memoryHits);
        const tools = this.config.toolRouter.listTools();

        const llmStarted = Date.now();
        const response = await llmClient.chat(contextMessages, tools);
        const llmDuration = Date.now() - llmStarted;

        yield this.createEvent(ctx, stepId, rootSpan, 'llm.called', {
          model: this.config.modelConfig.model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          duration_ms: llmDuration,
        });

        if (response.toolCalls && response.toolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
          });
          const toolResult = await this.handleToolCalls(ctx, stepId, rootSpan, response.toolCalls);
          messages.push(...toolResult.newMessages);
          lastToolResult = toolResult.lastResult;
          yield* toolResult.events;

          await this.saveCheckpoint(ctx, stepId, messages, memoryHits, lastToolResult);

          yield this.createEvent(ctx, stepId, rootSpan, 'step.completed', {
            stepNumber: step,
            resultType: 'tool_call',
            duration_ms: Date.now() - stepStart,
          });
          continue;
        }

        messages.push({ role: 'assistant', content: response.content });
        await this.saveCheckpoint(ctx, stepId, messages, memoryHits, lastToolResult);

        yield this.createEvent(ctx, stepId, rootSpan, 'step.completed', {
          stepNumber: step,
          resultType: 'final_answer',
          duration_ms: Date.now() - stepStart,
        });

        yield this.createEvent(ctx, stepId, rootSpan, 'run.completed', {
          output: response.content,
          duration_ms: Date.now() - startedAt,
        });

        return {
          status: 'completed',
          output: response.content,
          steps,
        };
      }

      throw new Error(`Max steps (${this.maxSteps}) reached`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stepId = generateStepId(Math.max(steps, 1));
      yield this.createEvent(ctx, stepId, rootSpan, 'run.failed', {
        error: {
          code: 'AGENT_ERROR',
          message,
        },
      });
      return {
        status: 'failed',
        error: message,
        steps,
      };
    }
  }

  private buildMemoryQuery(messages: Message[]): string {
    const recent = messages.slice(-4).map((msg) => `${msg.role}: ${msg.content}`).join('\n');
    return recent || 'recent context';
  }

  private buildModelMessages(
    history: Message[],
    memoryHits: Array<{ id: string; snippet: string; score: number; type: string }>
  ): Message[] {
    const memoryLines = memoryHits
      .map((item, index) => `${index + 1}. [${item.id}] (${item.type},${item.score.toFixed(3)}): ${item.snippet}`)
      .join('\n');
    const historySummary = history
      .slice(-8)
      .map((message) => `${message.role}: ${message.content.slice(0, 220)}`)
      .join('\n');

    const basePrompt = this.config.systemPrompt ?? SYSTEM_PROMPT;
    const system = `${basePrompt}

Conversation summary:
${historySummary || '(none)'}

Retrieved memory summaries:
${memoryLines || '(none)'}

When you need full memory details, call memory_get(id).`;

    const trimmedHistory = history.slice(-12);
    return [{ role: 'system', content: system }, ...trimmedHistory];
  }

  private async handleToolCalls(
    ctx: RunnerContext,
    stepId: string,
    rootSpan: string,
    toolCalls: ToolCall[]
  ): Promise<{
    events: Event[];
    newMessages: Message[];
    lastResult: unknown;
  }> {
    const events: Event[] = [];
    const newMessages: Message[] = [];
    let lastResult: unknown = null;

    for (const toolCall of toolCalls) {
      events.push(
        this.createEvent(ctx, stepId, rootSpan, 'tool.called', {
          toolName: toolCall.name,
          args: toolCall.parameters,
        })
      );

      const result = await this.config.toolRouter.callTool(
        toolCall.name,
        toolCall.parameters,
        this.config.agentContext
      );

      if (result.blocked) {
        events.push(
          this.createEvent(ctx, stepId, rootSpan, 'tool.blocked', {
            toolName: toolCall.name,
            args: toolCall.parameters,
            reason: result.error ?? 'Blocked by policy',
            role_id: this.config.agentContext?.roleId,
          })
        );
      } else {
        events.push(this.createToolResultEvent(ctx, stepId, rootSpan, toolCall.name, result));
      }

      lastResult = result.success ? result.result : result.error;
      newMessages.push({
        role: 'tool',
        content: result.success
          ? JSON.stringify(result.result)
          : `Error: ${result.error ?? 'Unknown tool error'}`,
        toolCallId: toolCall.id,
      });
    }

    return { events, newMessages, lastResult };
  }

  private async saveCheckpoint(
    ctx: RunnerContext,
    stepId: string,
    messages: Message[],
    memoryHits: Array<{ id: string; snippet: string; score: number; type: string }>,
    lastToolResult: unknown
  ): Promise<void> {
    await this.config.checkpointService.save(
      ctx.runId,
      ctx.agentId,
      stepId,
      {
        working_state: {
          memory_hits: memoryHits,
          last_tool_result: lastToolResult,
          plan: 'single-agent-loop',
        },
        messages,
      }
    );
  }

  private createEvent<T extends EventType>(
    ctx: RunnerContext,
    stepId: string,
    rootSpan: string,
    type: T,
    payload: Extract<Event, { type: T }>['payload']
  ): Extract<Event, { type: T }> {
    return {
      v: 1,
      ts: new Date().toISOString(),
      session_key: ctx.sessionKey,
      run_id: ctx.runId,
      agent_id: ctx.agentId,
      step_id: stepId,
      span_id: generateSpanId(),
      parent_span_id: rootSpan,
      redaction: { contains_secrets: false },
      type,
      payload,
    } as Extract<Event, { type: T }>;
  }

  private createToolResultEvent(
    ctx: RunnerContext,
    stepId: string,
    rootSpan: string,
    toolName: string,
    result: ToolResult
  ): Extract<Event, { type: 'tool.result' }> {
    return this.createEvent(ctx, stepId, rootSpan, 'tool.result', {
      toolName,
      result: result.result,
      isError: !result.success,
      ...(result.success
        ? {}
        : {
            error: {
              code: 'TOOL_ERROR',
              message: result.error ?? 'Unknown tool error',
            },
          }),
    });
  }
}
