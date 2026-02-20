import type { LLMConfig, Message, ToolCall, ContentPart } from '../../types/agent.js';
import { getMessageText } from '../../types/agent.js';
import type { Event, EventType } from '../../types/events.js';
import type { ScopeContext } from './scope.js';
import { createLLMClient, type ILLMClient } from '../agent/llm-client.js';
import { generateSpanId, generateStepId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';
import { CheckpointService } from './checkpoint-service.js';
import { CompactionService } from './compaction-service.js';
import { MemoryService } from './memory-service.js';
import { PromptComposer, type SkillInjection } from './prompt-composer.js';
import { RuntimeToolRouter } from './tool-router.js';
import { TokenBudgetManager } from './token-budget-manager.js';
import { ToolCallScheduler } from './tool-scheduler.js';
import type { ToolResult } from '../../types/agent.js';
import type { AgentContext } from './tool-policy.js';
import type { GroupWithRoles } from './group-repository.js';

export interface RunnerContext {
  runId: string;
  sessionKey: string;
  scope: ScopeContext;
  agentId: string;
  groupId?: string;
  agentInstanceId?: string;
  abortSignal?: AbortSignal;
  /** Prior conversation history from earlier runs in the same session */
  history?: Message[];
  /** Multipart input content (text + images/files) when attachments are present */
  inputContent?: ContentPart[];
  /** Callback to emit events immediately (for approval flow SSE broadcast) */
  onEvent?: (event: Event) => void;
  /** Callback to transition run to waiting status */
  onWaiting?: () => Promise<void>;
  /** Callback to resume run from waiting status */
  onResumed?: () => Promise<void>;
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
  /** Tool call scheduler for parallel/serial execution */
  toolScheduler?: ToolCallScheduler;
  /** Prompt composer for layered prompt building */
  promptComposer?: PromptComposer;
  /** Token budget manager for context tracking */
  budgetManager?: TokenBudgetManager;
  /** Compaction service for context compression */
  compactionService?: CompactionService;
  /** Skill content injections (loaded SKILL.md content) */
  skillInjections?: SkillInjection[];
  /** Available groups for escalation (injected into system prompt) */
  availableGroups?: GroupWithRoles[];
  /** Working directory for environment context */
  workDir?: string;
}

/** Max consecutive identical tool call signatures before doom-loop breaker fires */
const DOOM_LOOP_THRESHOLD = 3;

class RunCancelledError extends Error {
  constructor(message: string = 'Run cancelled by user') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

export class SingleAgentRunner implements AgentRunner {
  private readonly maxSteps: number;
  private readonly toolScheduler: ToolCallScheduler;
  private readonly promptComposer: PromptComposer;
  private readonly budgetManager: TokenBudgetManager | null;
  private readonly compactionService: CompactionService | null;
  /** Tracks recent tool call signatures for doom-loop detection */
  private readonly recentToolSignatures: string[] = [];

  constructor(private readonly config: SingleAgentRunnerConfig) {
    this.maxSteps = config.maxSteps;
    this.toolScheduler = config.toolScheduler ?? new ToolCallScheduler();
    this.promptComposer = config.promptComposer ?? new PromptComposer({
      ...(config.systemPrompt != null && { basePrompt: config.systemPrompt }),
      ...(config.modelConfig.provider !== 'mock' && { provider: config.modelConfig.provider }),
    });
    this.budgetManager = config.budgetManager ?? null;
    this.compactionService = config.compactionService ?? null;
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new RunCancelledError();
    }
  }

  async *run(input: string, ctx: RunnerContext): AsyncGenerator<Event, RunnerResult, void> {
    const userContent: string | ContentPart[] = ctx.inputContent ?? input;
    let messages: Message[] = [
      ...(ctx.history ?? []),
      { role: 'user', content: userContent },
    ];
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
        this.throwIfAborted(ctx.abortSignal);
        steps = step;
        const stepId = generateStepId(step);
        const stepStart = Date.now();

        yield this.createEvent(ctx, stepId, rootSpan, 'step.started', {
          stepNumber: step,
        });

        // ── Context budget check & auto-compaction ──
        const compactionEvents = yield* this.maybeCompactContext(
          messages, ctx, stepId, rootSpan, step
        );
        if (compactionEvents.compacted) {
          messages = compactionEvents.messages;
        }

        // ── Memory retrieval ──
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
          : await this.config.memoryService.memory_search_pa({
              query: memoryQuery,
              scope: memoryScope,
              top_k: 6,
              ...(ctx.agentInstanceId ? { agent_instance_id: ctx.agentInstanceId } : {}),
            });

        // ── Compose prompt via PromptComposer ──
        const skills = this.config.toolRouter.listSkills();
        const tools = this.config.toolRouter.listTools();
        const contextMessages = this.promptComposer.compose({
          history: messages,
          memoryHits,
          skills,
          ...(this.config.skillInjections ? { skillInjections: this.config.skillInjections } : {}),
          ...(this.config.agentContext ? { agentContext: this.config.agentContext } : {}),
          ...(this.config.availableGroups ? { availableGroups: this.config.availableGroups } : {}),
          ...(this.config.workDir
            ? {
                environment: {
                  cwd: this.config.workDir,
                  date: new Date().toISOString().slice(0, 10),
                  availableToolNames: tools.map((t) => t.name),
                },
              }
            : {}),
          ...(this.budgetManager
            ? {
                budget: {
                  utilization: this.budgetManager.utilization,
                  currentStep: step,
                  maxSteps: this.maxSteps,
                  compactionCount: this.budgetManager.currentCompactionCount,
                },
              }
            : {}),
        });

        // ── LLM call ──
        const llmStarted = Date.now();
        const llmOptions = ctx.abortSignal ? { signal: ctx.abortSignal } : undefined;
        const response = llmClient.chatStream
          ? yield* this.callLLMStream(llmClient, contextMessages, tools, ctx, stepId, rootSpan)
          : await llmClient.chat(contextMessages, tools, llmOptions);
        this.throwIfAborted(ctx.abortSignal);
        const llmDuration = Date.now() - llmStarted;

        // Update budget tracker
        this.budgetManager?.update(response.usage);

        yield this.createEvent(ctx, stepId, rootSpan, 'llm.called', {
          model: this.config.modelConfig.model,
          promptTokens: response.usage.promptTokens,
          completionTokens: response.usage.completionTokens,
          totalTokens: response.usage.totalTokens,
          duration_ms: llmDuration,
        });

        // ── Tool calls via ToolCallScheduler ──
        if (response.toolCalls && response.toolCalls.length > 0) {
          // Doom-loop detection
          const doomDetected = this.detectRepeatedToolPattern(response.toolCalls);
          if (doomDetected) {
            yield this.createEvent(ctx, stepId, rootSpan, 'run.warning', {
              code: 'DOOM_LOOP_DETECTED',
              message: `Repeated identical tool calls detected (${DOOM_LOOP_THRESHOLD}x). Breaking loop.`,
            });
            messages.push({
              role: 'assistant',
              content: response.content,
              toolCalls: response.toolCalls,
            });
            const firstToolCall = response.toolCalls[0];
            if (firstToolCall) {
              messages.push({
                role: 'tool',
                content: 'Error: Doom loop detected — you are repeating the same tool call with identical parameters. Try a different approach or provide a final answer.',
                toolCallId: firstToolCall.id,
              });
            }
            continue;
          }

          messages.push({
            role: 'assistant',
            content: response.content,
            toolCalls: response.toolCalls,
          });

          // Use ToolCallScheduler for batch execution
          const batchResult = await this.toolScheduler.executeBatch(
            response.toolCalls,
            this.config.toolRouter,
            {
              runId: ctx.runId,
              sessionKey: ctx.sessionKey,
              agentId: ctx.agentId,
              stepId,
              rootSpan,
              ...(this.config.agentContext ? { agentContext: this.config.agentContext } : {}),
              ...(ctx.abortSignal ? { abortSignal: ctx.abortSignal } : {}),
              ...(ctx.onEvent ? { onEvent: ctx.onEvent } : {}),
              ...(ctx.onWaiting ? { onWaiting: ctx.onWaiting } : {}),
              ...(ctx.onResumed ? { onResumed: ctx.onResumed } : {}),
            }
          );

          // Convert batch results to messages
          for (const execResult of batchResult.results) {
            const r = execResult.result;
            lastToolResult = r.success ? r.result : r.error;
            messages.push({
              role: 'tool',
              content: r.success
                ? JSON.stringify(r.result)
                : `Error: ${r.error ?? 'Unknown tool error'}`,
              toolCallId: execResult.toolCall.id,
            });
          }

          // Yield all batch events
          for (const event of batchResult.events) {
            yield event;
          }

          await this.saveCheckpoint(ctx, stepId, messages, memoryHits, lastToolResult);

          yield this.createEvent(ctx, stepId, rootSpan, 'step.completed', {
            stepNumber: step,
            resultType: 'tool_call',
            duration_ms: Date.now() - stepStart,
          });
          continue;
        }

        // ── Final answer ──
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
      const code = error instanceof RunCancelledError ? 'RUN_CANCELLED' : 'AGENT_ERROR';
      yield this.createEvent(ctx, stepId, rootSpan, 'run.failed', {
        error: {
          code,
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

  private async *callLLMStream(
    llmClient: ILLMClient,
    contextMessages: Message[],
    tools: ReturnType<RuntimeToolRouter['listTools']>,
    ctx: RunnerContext,
    stepId: string,
    rootSpan: string
  ): AsyncGenerator<Event, import('../../types/agent.js').LLMResponse, void> {
    const llmOptions = ctx.abortSignal ? { signal: ctx.abortSignal } : undefined;
    const stream = llmClient.chatStream!(contextMessages, tools, llmOptions);
    let fullContent = '';
    let tokenIndex = 0;
    let finalToolCalls: ToolCall[] | undefined;
    let finalUsage: import('../../types/agent.js').LLMResponse['usage'] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for await (const chunk of stream) {
      this.throwIfAborted(ctx.abortSignal);
      if (chunk.delta) {
        fullContent += chunk.delta;
        yield this.createEvent(ctx, stepId, rootSpan, 'llm.token', {
          token: chunk.delta,
          tokenIndex,
        });
        tokenIndex++;
      }
      if (chunk.toolCalls) {
        finalToolCalls = chunk.toolCalls;
      }
      if (chunk.usage) {
        finalUsage = chunk.usage;
      }
    }

    return {
      content: fullContent,
      toolCalls: finalToolCalls,
      usage: finalUsage,
    };
  }

  private buildMemoryQuery(messages: Message[]): string {
    const recent = messages.slice(-4).map((msg) => `${msg.role}: ${getMessageText(msg.content)}`).join('\n');
    return recent || 'recent context';
  }

  /**
   * Doom-loop detection: track tool call signatures and detect repeated patterns.
   * Returns true if the same tool+params signature repeats >= DOOM_LOOP_THRESHOLD times.
   */
  private detectRepeatedToolPattern(toolCalls: ToolCall[]): boolean {
    const signature = toolCalls
      .map((tc) => `${tc.name}:${JSON.stringify(tc.parameters)}`)
      .sort()
      .join('|');

    this.recentToolSignatures.push(signature);
    if (this.recentToolSignatures.length > DOOM_LOOP_THRESHOLD * 2) {
      this.recentToolSignatures.splice(0, this.recentToolSignatures.length - DOOM_LOOP_THRESHOLD * 2);
    }

    const tail = this.recentToolSignatures.slice(-DOOM_LOOP_THRESHOLD);
    if (tail.length < DOOM_LOOP_THRESHOLD) return false;
    return tail.every((s) => s === signature);
  }

  /**
   * Check context budget and auto-compact if needed.
   */
  private *maybeCompactContext(
    messages: Message[],
    ctx: RunnerContext,
    stepId: string,
    rootSpan: string,
    currentStep: number
  ): Generator<Event, { compacted: boolean; messages: Message[] }, void> {
    if (!this.budgetManager || !this.compactionService) {
      return { compacted: false, messages };
    }

    // Emit warning if approaching threshold
    if (this.budgetManager.shouldWarn()) {
      yield this.createEvent(ctx, stepId, rootSpan, 'run.warning', {
        code: 'CONTEXT_HIGH_WATER',
        message: `Context utilization at ${(this.budgetManager.utilization * 100).toFixed(0)}%`,
        context: { step: currentStep },
      });
    }

    // Compact if over threshold
    if (this.budgetManager.shouldCompact()) {
      logger.info('Triggering context compaction', {
        runId: ctx.runId,
        utilization: this.budgetManager.utilization,
      });

      const result = this.compactionService.compactMessages(messages);
      this.budgetManager.recordCompaction();

      yield this.createEvent(ctx, stepId, rootSpan, 'run.compacted', {
        messages_before: result.messages_before,
        messages_after: result.messages_after,
        tokens_saved: result.tokens_saved_estimate,
      });

      return { compacted: true, messages: result.messages };
    }

    return { compacted: false, messages };
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
          budget_state: this.budgetManager?.getState(),
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
