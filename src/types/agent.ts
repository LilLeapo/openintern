import { z } from 'zod';

/**
 * Agent status schema
 */
export const AgentStatusSchema = z.object({
  status: z.enum(['idle', 'running', 'completed', 'failed']),
  currentStep: z.number().nonnegative(),
  maxSteps: z.number().positive(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  error: z.string().optional(),
});

export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * Tool call schema
 */
export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  parameters: z.record(z.unknown()),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

/**
 * Step result schema
 */
export const StepResultSchema = z.object({
  stepId: z.string(),
  type: z.enum(['tool_call', 'final_answer', 'continue']),
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
});

export type StepResult = z.infer<typeof StepResultSchema>;

/**
 * Message role schema
 */
export const MessageRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export type MessageRole = z.infer<typeof MessageRoleSchema>;

/**
 * Message schema for LLM context
 */
export const MessageSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
  toolCallId: z.string().optional(),
  name: z.string().optional(),
});

export type Message = z.infer<typeof MessageSchema>;

/**
 * Tool definition schema
 */
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.unknown()),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * Tool result schema
 */
export const ToolResultSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  duration: z.number().nonnegative(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * LLM response schema
 */
export const LLMResponseSchema = z.object({
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  usage: z.object({
    promptTokens: z.number().nonnegative(),
    completionTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
  }),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

/**
 * LLM context schema
 */
export const LLMContextSchema = z.object({
  systemPrompt: z.string(),
  messages: z.array(MessageSchema),
  totalTokens: z.number().nonnegative(),
});

export type LLMContext = z.infer<typeof LLMContextSchema>;

/**
 * Agent loop configuration
 */
export interface AgentLoopConfig {
  maxSteps: number;
  timeout?: number;
  modelConfig?: {
    provider: 'openai' | 'anthropic' | 'mock';
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Context manager configuration
 */
export interface ContextConfig {
  maxTokens: number;
  systemPrompt: string;
  includeMemory: boolean;
  maxMessages?: number;
}

/**
 * LLM client configuration
 */
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'mock';
  model: string;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
}
