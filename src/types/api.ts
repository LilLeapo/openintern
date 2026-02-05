import { z } from 'zod';
import { RunMetaSchema, RunStatusSchema } from './run.js';
import { EventSchema } from './events.js';

/**
 * Create run request schema
 */
export const CreateRunRequestSchema = z.object({
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  input: z.string().min(1),
  agent_id: z.string().min(1).optional(),
});

export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

/**
 * Create run response schema
 */
export const CreateRunResponseSchema = z.object({
  run_id: z.string().regex(/^run_[a-zA-Z0-9]+$/),
  status: RunStatusSchema,
  created_at: z.string().datetime(),
});

export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;

/**
 * List runs response schema
 */
export const ListRunsResponseSchema = z.object({
  runs: z.array(RunMetaSchema),
  total: z.number().nonnegative(),
  page: z.number().positive(),
  limit: z.number().positive(),
});

export type ListRunsResponse = z.infer<typeof ListRunsResponseSchema>;

/**
 * Get run events response schema
 */
export const GetRunEventsResponseSchema = z.object({
  events: z.array(EventSchema),
  total: z.number().nonnegative(),
});

export type GetRunEventsResponse = z.infer<typeof GetRunEventsResponseSchema>;

/**
 * Error response schema
 */
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Queued run schema - for internal queue management
 */
export const QueuedRunSchema = z.object({
  run_id: z.string().regex(/^run_[a-zA-Z0-9]+$/),
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  input: z.string(),
  agent_id: z.string(),
  created_at: z.string().datetime(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
});

export type QueuedRun = z.infer<typeof QueuedRunSchema>;

/**
 * SSE event types
 */
export type SSEEventType = 'run.event' | 'ping' | 'connected';

/**
 * SSE message format
 */
export interface SSEMessage {
  event: SSEEventType;
  data: unknown;
  id?: string;
}
