/**
 * AgentLoop - Core agent execution loop
 *
 * Features:
 * - Plan/Act/Observe loop
 * - Max steps control
 * - Tool call handling
 * - State management
 * - Event emission
 */

import path from 'node:path';
import type {
  AgentLoopConfig,
  AgentStatus,
  LLMConfig,
  StepResult,
  ToolCall,
  Message,
} from '../../types/agent.js';
import type { Event } from '../../types/events.js';
import { EventStore } from '../store/event-store.js';
import { ContextManager } from './context-manager.js';
import { ToolRouter } from './tool-router.js';
import { createLLMClient, type ILLMClient } from './llm-client.js';
import { RetryPolicy } from './retry-policy.js';
import { detectOrphanedToolCalls, generateSyntheticResults } from './orphan-detector.js';
import { generateSpanId, generateStepId } from '../../utils/ids.js';
import { logger } from '../../utils/logger.js';

/**
 * Resolve default model config from environment variables
 */
function resolveDefaultModelConfig(): LLMConfig {
  const provider = process.env['LLM_PROVIDER'] as 'openai' | 'anthropic' | 'mock' | undefined;
  const model = process.env['LLM_MODEL'];

  // If env vars specify a real provider, use it
  if (provider && provider !== 'mock' && model) {
    return { provider, model, temperature: 0.7, maxTokens: 2000 };
  }

  // Auto-detect from API key env vars
  if (process.env['OPENAI_API_KEY'] && !provider) {
    return { provider: 'openai', model: model ?? 'gpt-4o', temperature: 0.7, maxTokens: 2000 };
  }
  if (process.env['ANTHROPIC_API_KEY'] && !provider) {
    return { provider: 'anthropic', model: model ?? 'claude-sonnet-4-20250514', temperature: 0.7, maxTokens: 2000 };
  }

  return { provider: 'mock', model: 'mock-model', temperature: 0.7, maxTokens: 2000 };
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  maxSteps: 10,
  timeout: 300000, // 5 minutes
  modelConfig: resolveDefaultModelConfig(),
};

/**
 * Event callback type for broadcasting events
 */
export type EventCallback = (event: Event) => void;

/**
 * AgentLoop class for executing agent tasks
 */
export class AgentLoop {
  private runId: string;
  private sessionKey: string;
  private agentId: string;
  private config: AgentLoopConfig;
  private status: AgentStatus;
  private eventStore: EventStore;
  private contextManager: ContextManager;
  private toolRouter: ToolRouter;
  private llmClient: ILLMClient;
  private eventCallback?: EventCallback;
  private startTime: number = 0;
  private rootSpanId: string;
  private aborted = false;
  private retryPolicy: RetryPolicy;

  constructor(
    runId: string,
    sessionKey: string,
    config: Partial<AgentLoopConfig> = {},
    baseDir: string = 'data'
  ) {
    this.runId = runId;
    this.sessionKey = sessionKey;
    this.agentId = 'main';
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rootSpanId = generateSpanId();

    // Initialize status
    this.status = {
      status: 'idle',
      currentStep: 0,
      maxSteps: this.config.maxSteps,
      startedAt: new Date().toISOString(),
    };

    // Initialize components
    this.eventStore = new EventStore(sessionKey, runId, baseDir);
    // Compute the resolved workDir for context manager
    const resolvedWorkDir = this.config.workDir
      ? path.resolve(this.config.workDir)
      : path.resolve(baseDir, 'workspace');
    this.contextManager = new ContextManager(runId, sessionKey, { workDir: resolvedWorkDir }, baseDir);
    const toolRouterConfig: Partial<import('./tool-router.js').ToolRouterConfig> = {
      memoryBaseDir: `${baseDir}/memory/shared`,
      baseDir,
    };
    if (this.config.workDir) {
      toolRouterConfig.workDir = this.config.workDir;
    }
    this.toolRouter = new ToolRouter(toolRouterConfig);

    // Initialize LLM client
    const modelConfig = this.config.modelConfig ?? DEFAULT_CONFIG.modelConfig!;
    this.llmClient = createLLMClient(modelConfig);

    // Initialize retry policy
    this.retryPolicy = new RetryPolicy(this.config.retry);
  }

  /**
   * Set event callback for broadcasting events
   */
  setEventCallback(callback: EventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return { ...this.status };
  }

  /**
   * Abort the execution
   */
  abort(): void {
    this.aborted = true;
    logger.info('Agent loop aborted', { runId: this.runId });
  }

  /**
   * Create base event fields
   */
  private createBaseEvent(stepId: string, parentSpanId: string | null = null): Omit<Event, 'type' | 'payload'> {
    return {
      v: 1,
      ts: new Date().toISOString(),
      session_key: this.sessionKey,
      run_id: this.runId,
      agent_id: this.agentId,
      step_id: stepId,
      span_id: generateSpanId(),
      parent_span_id: parentSpanId,
      redaction: { contains_secrets: false },
    };
  }

  /**
   * Emit and store an event
   */
  private async emitEvent(event: Event): Promise<void> {
    await this.eventStore.append(event);
    if (this.eventCallback) {
      this.eventCallback(event);
    }
  }

  /**
   * Resume execution from a checkpoint
   */
  async resume(): Promise<void> {
    this.startTime = Date.now();
    this.status.status = 'running';
    this.status.startedAt = new Date().toISOString();

    const checkpoint = await this.contextManager.loadCheckpoint();
    if (!checkpoint) {
      logger.warn('No checkpoint found, cannot resume', { runId: this.runId });
      throw new Error('No checkpoint found for resume');
    }

    const stepId = checkpoint.step_id;
    this.status.currentStep = this.contextManager.getCurrentStepNumber();

    logger.info('Resuming from checkpoint', {
      runId: this.runId,
      stepId,
      messageCount: this.contextManager.getMessages().length,
    });

    // Detect and fix orphaned tool calls
    const messages = this.contextManager.getMessages();
    const orphans = detectOrphanedToolCalls(messages);
    if (orphans.length > 0) {
      const syntheticResults = generateSyntheticResults(orphans);
      for (const msg of syntheticResults) {
        this.contextManager.addMessage(msg.role, msg.content, msg.toolCallId);
      }
      logger.info('Injected synthetic results for orphaned tool calls', {
        count: orphans.length,
      });
    }

    // Emit run.resumed event
    await this.emitEvent({
      ...this.createBaseEvent(stepId, null),
      type: 'run.resumed',
      payload: {
        checkpoint_step_id: stepId,
        orphaned_tool_calls: orphans.length,
      },
    } as Event);

    // Continue execution loop
    try {
      while (this.status.currentStep < this.config.maxSteps && !this.aborted) {
        const availability = await this.contextManager.checkContextAvailability();
        if (!availability.available) {
          throw new Error(`Context window exhausted: ${availability.warning}`);
        }

        const result = await this.step();

        if (result.type === 'final_answer') {
          const duration = Date.now() - this.startTime;
          this.status.status = 'completed';
          this.status.completedAt = new Date().toISOString();

          await this.emitEvent({
            ...this.createBaseEvent(generateStepId(this.status.currentStep), this.rootSpanId),
            type: 'run.completed',
            payload: { output: result.content, duration_ms: duration },
          } as Event);

          logger.info('Agent loop completed (resumed)', {
            runId: this.runId,
            steps: this.status.currentStep,
          });
          return;
        }
      }

      if (!this.aborted) {
        throw new Error(`Max steps (${this.config.maxSteps}) reached`);
      }
    } catch (error) {
      await this.handleError(error);
    }
  }

  /**
   * Execute the agent loop with user input
   */
  async execute(input: string): Promise<void> {
    this.startTime = Date.now();
    this.status.status = 'running';
    this.status.startedAt = new Date().toISOString();

    const stepId = generateStepId(0);

    logger.info('Agent loop started', { runId: this.runId, input: input.substring(0, 100) });

    // Emit run.started event
    await this.emitEvent({
      ...this.createBaseEvent(stepId, null),
      type: 'run.started',
      payload: { input },
    } as Event);

    // Add user message to context
    this.contextManager.addMessage('user', input);

    try {
      // Main loop
      while (this.status.currentStep < this.config.maxSteps && !this.aborted) {
        // Context window guard
        const availability = await this.contextManager.checkContextAvailability();
        if (!availability.available) {
          throw new Error(`Context window exhausted: ${availability.warning}`);
        }
        if (availability.warning) {
          logger.warn('Context window warning', {
            runId: this.runId,
            warning: availability.warning,
          });
        }

        const result = await this.step();

        if (result.type === 'final_answer') {
          // Run completed successfully
          const duration = Date.now() - this.startTime;
          this.status.status = 'completed';
          this.status.completedAt = new Date().toISOString();

          await this.emitEvent({
            ...this.createBaseEvent(generateStepId(this.status.currentStep), this.rootSpanId),
            type: 'run.completed',
            payload: { output: result.content, duration_ms: duration },
          } as Event);

          logger.info('Agent loop completed', { runId: this.runId, steps: this.status.currentStep });
          return;
        }
      }

      // Max steps reached
      if (!this.aborted) {
        throw new Error(`Max steps (${this.config.maxSteps}) reached`);
      }
    } catch (error) {
      await this.handleError(error);
    }
  }

  /**
   * Execute a single step
   */
  async step(): Promise<StepResult> {
    this.status.currentStep++;
    const stepNumber = this.status.currentStep;
    const stepId = generateStepId(stepNumber);
    const stepStartTime = Date.now();

    logger.debug('Step started', { runId: this.runId, step: stepNumber });

    // Emit step.started event
    await this.emitEvent({
      ...this.createBaseEvent(stepId, this.rootSpanId),
      type: 'step.started',
      payload: { stepNumber },
    } as Event);

    // Build context
    const context = await this.contextManager.buildContext();

    // Get available tools
    const tools = this.toolRouter.listTools();

    // Prepare messages for LLM
    const messages: Message[] = [
      { role: 'system', content: context.systemPrompt },
      ...context.messages,
    ];

    // Call LLM with retry policy
    const llmStartTime = Date.now();
    const { result: response, attempts } = await this.retryPolicy.execute(
      () => this.llmClient.chat(messages, tools),
      `llm.chat step ${stepNumber}`,
    );
    const llmDuration = Date.now() - llmStartTime;

    // Emit step.retried event if retries occurred
    if (attempts > 1) {
      await this.emitEvent({
        ...this.createBaseEvent(stepId, this.rootSpanId),
        type: 'step.retried',
        payload: {
          stepNumber,
          attempt: attempts,
          reason: 'LLM call retried due to transient error',
          delayMs: llmDuration,
        },
      } as Event);
    }

    // Emit llm.called event
    await this.emitEvent({
      ...this.createBaseEvent(stepId, this.rootSpanId),
      type: 'llm.called',
      payload: {
        model: this.config.modelConfig?.model ?? 'mock-model',
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        duration_ms: llmDuration,
      },
    } as Event);

    // Process response
    let result: StepResult;

    if (response.toolCalls && response.toolCalls.length > 0) {
      // Add assistant message with tool_calls to context BEFORE executing tools
      this.contextManager.addMessage('assistant', response.content, undefined, response.toolCalls);
      // Handle tool calls
      result = await this.handleToolCalls(stepId, response.toolCalls);
    } else {
      // Final answer
      result = {
        stepId,
        type: 'final_answer',
        content: response.content,
      };

      // Add assistant message to context
      this.contextManager.addMessage('assistant', response.content);
    }

    // Emit step.completed event
    const stepDuration = Date.now() - stepStartTime;
    await this.emitEvent({
      ...this.createBaseEvent(stepId, this.rootSpanId),
      type: 'step.completed',
      payload: {
        stepNumber,
        resultType: result.type,
        duration_ms: stepDuration,
      },
    } as Event);

    // Save checkpoint
    await this.contextManager.saveCheckpoint();

    return result;
  }

  /**
   * Handle tool calls from LLM response
   */
  private async handleToolCalls(stepId: string, toolCalls: ToolCall[]): Promise<StepResult> {
    const results: string[] = [];

    for (const toolCall of toolCalls) {
      // Emit tool.called event
      await this.emitEvent({
        ...this.createBaseEvent(stepId, this.rootSpanId),
        type: 'tool.called',
        payload: {
          toolName: toolCall.name,
          args: toolCall.parameters,
        },
      } as Event);

      // Execute tool
      const toolResult = await this.toolRouter.callTool(
        toolCall.name,
        toolCall.parameters
      );

      // Emit tool.result event
      await this.emitEvent({
        ...this.createBaseEvent(stepId, this.rootSpanId),
        type: 'tool.result',
        payload: {
          toolName: toolCall.name,
          result: toolResult.result,
          isError: !toolResult.success,
          error: toolResult.error ? {
            code: 'TOOL_ERROR',
            message: toolResult.error,
          } : undefined,
        },
      } as Event);

      // Format result for context
      const resultStr = toolResult.success
        ? JSON.stringify(toolResult.result)
        : `Error: ${toolResult.error}`;
      results.push(`[${toolCall.name}]: ${resultStr}`);

      // Add tool result to context
      this.contextManager.addMessage(
        'tool',
        resultStr,
        toolCall.id
      );
    }

    return {
      stepId,
      type: 'tool_call',
      content: results.join('\n'),
      toolCalls,
    };
  }

  /**
   * Handle errors during execution
   */
  private async handleError(error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const stepId = generateStepId(this.status.currentStep);

    this.status.status = 'failed';
    this.status.error = errorMessage;
    this.status.completedAt = new Date().toISOString();

    logger.error('Agent loop failed', {
      runId: this.runId,
      error: errorMessage,
      step: this.status.currentStep,
    });

    // Save checkpoint on failure for potential recovery
    try {
      await this.contextManager.saveCheckpoint();
      logger.debug('Failure checkpoint saved', { runId: this.runId });
    } catch (cpErr) {
      logger.warn('Failed to save failure checkpoint', {
        error: cpErr instanceof Error ? cpErr.message : String(cpErr),
      });
    }

    await this.emitEvent({
      ...this.createBaseEvent(stepId, this.rootSpanId),
      type: 'run.failed',
      payload: {
        error: {
          code: 'AGENT_ERROR',
          message: errorMessage,
        },
      },
    } as Event);
  }
}