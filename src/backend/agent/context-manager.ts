/**
 * ContextManager - Build and manage LLM context
 *
 * Features:
 * - Build LLM context (system prompt + history)
 * - Context trimming (token limit)
 * - Memory retrieval
 * - Checkpoint management
 */

import type {
  ContextConfig,
  LLMContext,
  Message,
} from '../../types/agent.js';
import type { MemoryItem } from '../../types/memory.js';
import type { Checkpoint } from '../../types/checkpoint.js';
import { CheckpointStore } from '../store/checkpoint-store.js';
import { MemoryStore } from '../store/memory-store.js';
import { logger } from '../../utils/logger.js';

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant. You have access to tools that are provided via the function calling interface — use them when appropriate.

Guidelines:
- You do NOT have built-in memory across conversations. If the user asks a personal question (like your name) or references past information, you MUST call memory.search first before answering. Never guess or make up information.
- For file operations, all paths are relative to your working directory.
- Always respond in the same language as the user's message.`;

const DEFAULT_CONFIG: ContextConfig = {
  maxTokens: 4000,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  includeMemory: true,
  maxMessages: 20,
};

/**
 * ContextManager class for managing LLM context
 */
export class ContextManager {
  private config: ContextConfig;
  private messages: Message[] = [];
  private checkpointStore: CheckpointStore;
  private memoryStore: MemoryStore;
  private runId: string;
  private sessionKey: string;
  private currentStepNumber = 0;

  constructor(
    runId: string,
    sessionKey: string,
    config: Partial<ContextConfig> = {},
    baseDir: string = 'data'
  ) {
    this.runId = runId;
    this.sessionKey = sessionKey;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.checkpointStore = new CheckpointStore(sessionKey, runId, baseDir);
    this.memoryStore = new MemoryStore(`${baseDir}/memory/shared`);
  }

  /**
   * Get current step number
   */
  getCurrentStepNumber(): number {
    return this.currentStepNumber;
  }

  /**
   * Increment step number
   */
  incrementStep(): number {
    this.currentStepNumber++;
    return this.currentStepNumber;
  }

  /**
   * Set step number
   */
  setStepNumber(step: number): void {
    this.currentStepNumber = step;
  }

  /**
   * Add a message to the context
   */
  addMessage(role: Message['role'], content: string, toolCallId?: string, toolCalls?: Message['toolCalls']): void {
    const message: Message = { role, content };
    if (toolCallId) {
      message.toolCallId = toolCallId;
    }
    if (toolCalls && toolCalls.length > 0) {
      message.toolCalls = toolCalls;
    }
    this.messages.push(message);
    logger.debug('Message added to context', { role, contentLength: content.length });
  }

  /**
   * Get all messages
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * Clear all messages
   */
  clearMessages(): void {
    this.messages = [];
  }

  /**
   * Estimate token count for a string (simple approximation)
   */
  private estimateTokens(text: string): number {
    // Simple approximation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Trim messages to fit within token limit
   */
  private trimMessages(messages: Message[], maxTokens: number): Message[] {
    const maxMessages = this.config.maxMessages ?? 20;

    // If we have too many messages, keep first and last N
    if (messages.length > maxMessages) {
      const keepFirst = 1; // Keep first user message
      const keepLast = maxMessages - keepFirst;
      const trimmed = [
        ...messages.slice(0, keepFirst),
        ...messages.slice(-keepLast),
      ];
      logger.debug('Messages trimmed by count', {
        original: messages.length,
        trimmed: trimmed.length,
      });
      return trimmed;
    }

    // Check token count
    let totalTokens = 0;
    for (const msg of messages) {
      totalTokens += this.estimateTokens(msg.content);
    }

    if (totalTokens <= maxTokens) {
      return messages;
    }

    // Remove messages from middle until under limit
    const result = [...messages];
    while (result.length > 2 && totalTokens > maxTokens) {
      const midIndex = Math.floor(result.length / 2);
      const removed = result.splice(midIndex, 1)[0];
      if (removed) {
        totalTokens -= this.estimateTokens(removed.content);
      }
    }

    logger.debug('Messages trimmed by tokens', {
      original: messages.length,
      trimmed: result.length,
      estimatedTokens: totalTokens,
    });

    return result;
  }

  /**
   * Retrieve relevant memories for a query
   */
  async retrieveMemory(query: string, topK: number = 3): Promise<MemoryItem[]> {
    if (!this.config.includeMemory) {
      return [];
    }

    try {
      const memories = await this.memoryStore.search(query, topK);
      logger.debug('Memory retrieved', { query, count: memories.length });
      return memories;
    } catch (error) {
      logger.warn('Failed to retrieve memory', {
        query,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Build the LLM context
   */
  async buildContext(): Promise<LLMContext> {
    // Auto-retrieve relevant memories based on last user message
    let memoryContext = '';
    if (this.config.includeMemory) {
      const lastUserMsg = [...this.messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        const memories = await this.retrieveMemory(lastUserMsg.content);
        if (memories.length > 0) {
          const memoryLines = memories.map((m) => `- ${m.content}`).join('\n');
          memoryContext = `\n\nRelevant memories:\n${memoryLines}`;
        }
      }
    }

    // Inject working directory info
    let workDirContext = '';
    if (this.config.workDir) {
      workDirContext = `\n\nFile tools working directory: ${this.config.workDir}\nAll file paths are relative to this directory. You can only access files within this directory.`;
    }

    const systemPrompt = this.config.systemPrompt + workDirContext + memoryContext;

    // Reserve tokens for system prompt
    const systemTokens = this.estimateTokens(systemPrompt);
    const availableTokens = this.config.maxTokens - systemTokens;

    // Trim messages to fit
    const trimmedMessages = this.trimMessages(this.messages, availableTokens);

    // Calculate total tokens
    let totalTokens = systemTokens;
    for (const msg of trimmedMessages) {
      totalTokens += this.estimateTokens(msg.content);
    }

    logger.debug('Context built', {
      messageCount: trimmedMessages.length,
      totalTokens,
    });

    return {
      systemPrompt: systemPrompt,
      messages: trimmedMessages,
      totalTokens,
    };
  }

  /**
   * Save checkpoint to storage
   */
  async saveCheckpoint(): Promise<void> {
    const stepId = `step_${this.currentStepNumber.toString().padStart(4, '0')}`;

    const checkpoint: Checkpoint = {
      v: 1,
      created_at: new Date().toISOString(),
      run_id: this.runId,
      step_id: stepId,
      state: {
        messages: this.messages.map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system' | 'tool',
          content: m.content,
        })),
      },
    };

    await this.checkpointStore.saveLatest(checkpoint);
    logger.debug('Checkpoint saved', { runId: this.runId, stepId });
  }

  /**
   * Load checkpoint from storage
   */
  async loadCheckpoint(): Promise<Checkpoint | null> {
    const checkpoint = await this.checkpointStore.loadLatest();

    if (checkpoint) {
      // Restore messages from checkpoint
      this.messages = checkpoint.state.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Extract step number from step_id
      const stepMatch = checkpoint.step_id.match(/step_(\d+)/);
      if (stepMatch && stepMatch[1]) {
        this.currentStepNumber = parseInt(stepMatch[1], 10);
      }

      logger.debug('Checkpoint loaded', {
        runId: this.runId,
        stepId: checkpoint.step_id,
        messageCount: this.messages.length,
      });
    }

    return checkpoint;
  }
}
