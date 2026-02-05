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
 * Event type enum
 */
export const EventTypeSchema = z.enum([
  'run.started',
  'run.completed',
  'run.failed',
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
 * Union of all event schemas
 */
export const EventSchema = z.discriminatedUnion('type', [
  RunStartedEventSchema,
  RunCompletedEventSchema,
  RunFailedEventSchema,
  ToolCalledEventSchema,
  ToolResultEventSchema,
]);

export type Event = z.infer<typeof EventSchema>;
