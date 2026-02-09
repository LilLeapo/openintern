import { z } from 'zod';

/**
 * Base event schema - common fields for all events
 */
export const BaseEventSchema = z.object({
  /** Schema version */
  v: z.literal(1),
  /** Timestamp in ISO 8601 format */
  ts: z.string().datetime(),
  /** Session identifier */
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  /** Run identifier */
  run_id: z.string().regex(/^run_[a-zA-Z0-9]+$/),
  /** Agent identifier */
  agent_id: z.string().min(1),
  /** Step identifier */
  step_id: z.string().regex(/^step_[0-9]+$/),
  /** Span identifier for tracing */
  span_id: z.string().regex(/^sp_[a-zA-Z0-9]+$/),
  /** Parent span identifier (null for root spans) */
  parent_span_id: z.string().regex(/^sp_[a-zA-Z0-9]+$/).nullable(),
  /** Redaction metadata */
  redaction: z.object({
    contains_secrets: z.boolean(),
  }),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

/**
 * Run started event payload
 */
export const RunStartedPayloadSchema = z.object({
  input: z.string(),
  config: z.record(z.unknown()).optional(),
});

/**
 * Run completed event payload
 */
export const RunCompletedPayloadSchema = z.object({
  output: z.string(),
  duration_ms: z.number().nonnegative(),
});

/**
 * Run failed event payload
 */
export const RunFailedPayloadSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

/**
 * Tool called event payload
 */
export const ToolCalledPayloadSchema = z.object({
  toolName: z.string(),
  args: z.record(z.unknown()),
});

/**
 * Tool result event payload
 */
export const ToolResultPayloadSchema = z.object({
  toolName: z.string(),
  result: z.unknown(),
  isError: z.boolean(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

/**
 * Step started event payload
 */
export const StepStartedPayloadSchema = z.object({
  stepNumber: z.number().nonnegative(),
});

/**
 * Step completed event payload
 */
export const StepCompletedPayloadSchema = z.object({
  stepNumber: z.number().nonnegative(),
  resultType: z.enum(['tool_call', 'final_answer', 'continue']),
  duration_ms: z.number().nonnegative(),
});

/**
 * LLM called event payload
 */
export const LLMCalledPayloadSchema = z.object({
  model: z.string(),
  promptTokens: z.number().nonnegative(),
  completionTokens: z.number().nonnegative(),
  totalTokens: z.number().nonnegative(),
  duration_ms: z.number().nonnegative(),
});

/**
 * Run resumed event payload
 */
export const RunResumedPayloadSchema = z.object({
  checkpoint_step_id: z.string(),
  orphaned_tool_calls: z.number().nonnegative(),
});

/**
 * Step retried event payload
 */
export const StepRetriedPayloadSchema = z.object({
  stepNumber: z.number().nonnegative(),
  attempt: z.number().positive(),
  reason: z.string(),
  delayMs: z.number().nonnegative(),
});

/**
 * LLM token streaming event payload
 */
export const LLMTokenPayloadSchema = z.object({
  token: z.string(),
  tokenIndex: z.number().nonnegative(),
});

/**
 * Event type enum
 */
export const EventTypeSchema = z.enum([
  'run.started',
  'run.completed',
  'run.failed',
  'run.resumed',
  'step.started',
  'step.completed',
  'step.retried',
  'llm.called',
  'llm.token',
  'tool.called',
  'tool.result',
]);

export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Run started event
 */
export const RunStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.started'),
  payload: RunStartedPayloadSchema,
});

export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

/**
 * Run completed event
 */
export const RunCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.completed'),
  payload: RunCompletedPayloadSchema,
});

export type RunCompletedEvent = z.infer<typeof RunCompletedEventSchema>;

/**
 * Run failed event
 */
export const RunFailedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.failed'),
  payload: RunFailedPayloadSchema,
});

export type RunFailedEvent = z.infer<typeof RunFailedEventSchema>;

/**
 * Run resumed event
 */
export const RunResumedEventSchema = BaseEventSchema.extend({
  type: z.literal('run.resumed'),
  payload: RunResumedPayloadSchema,
});

export type RunResumedEvent = z.infer<typeof RunResumedEventSchema>;

/**
 * Tool called event
 */
export const ToolCalledEventSchema = BaseEventSchema.extend({
  type: z.literal('tool.called'),
  payload: ToolCalledPayloadSchema,
});

export type ToolCalledEvent = z.infer<typeof ToolCalledEventSchema>;

/**
 * Tool result event
 */
export const ToolResultEventSchema = BaseEventSchema.extend({
  type: z.literal('tool.result'),
  payload: ToolResultPayloadSchema,
});

export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;

/**
 * Step started event
 */
export const StepStartedEventSchema = BaseEventSchema.extend({
  type: z.literal('step.started'),
  payload: StepStartedPayloadSchema,
});

export type StepStartedEvent = z.infer<typeof StepStartedEventSchema>;

/**
 * Step completed event
 */
export const StepCompletedEventSchema = BaseEventSchema.extend({
  type: z.literal('step.completed'),
  payload: StepCompletedPayloadSchema,
});

export type StepCompletedEvent = z.infer<typeof StepCompletedEventSchema>;

/**
 * Step retried event
 */
export const StepRetriedEventSchema = BaseEventSchema.extend({
  type: z.literal('step.retried'),
  payload: StepRetriedPayloadSchema,
});

export type StepRetriedEvent = z.infer<typeof StepRetriedEventSchema>;

/**
 * LLM called event
 */
export const LLMCalledEventSchema = BaseEventSchema.extend({
  type: z.literal('llm.called'),
  payload: LLMCalledPayloadSchema,
});

export type LLMCalledEvent = z.infer<typeof LLMCalledEventSchema>;

/**
 * LLM token streaming event
 */
export const LLMTokenEventSchema = BaseEventSchema.extend({
  type: z.literal('llm.token'),
  payload: LLMTokenPayloadSchema,
});

export type LLMTokenEvent = z.infer<typeof LLMTokenEventSchema>;

/**
 * Union of all event schemas
 */
export const EventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
  RunResumedEventSchema,
  ToolCalledEventSchema,
  ToolResultEventSchema,
  StepStartedEventSchema,
  StepCompletedEventSchema,
  StepRetriedEventSchema,
  LLMCalledEventSchema,
  LLMTokenEventSchema,
]);

export type Event = z.infer<typeof EventSchema>;
