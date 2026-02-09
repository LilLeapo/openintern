import { z } from 'zod';

/**
 * Run status enum
 */
export const RunStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Run metadata schema - for fast UI loading
 */
export const RunMetaSchema = z.object({
  /** Run identifier */
  run_id: z.string().regex(/^run_[a-zA-Z0-9]+$/),
  /** Session key */
  session_key: z.string().regex(/^s_[a-zA-Z0-9_]+$/),
  /** Run status */
  status: RunStatusSchema,
  /** Run start timestamp */
  started_at: z.string().datetime(),
  /** Run end timestamp (null if still running) */
  ended_at: z.string().datetime().nullable(),
  /** Duration in milliseconds (null if still running) */
  duration_ms: z.number().nonnegative().nullable(),
  /** Total event count */
  event_count: z.number().nonnegative(),
  /** Tool call count */
  tool_call_count: z.number().nonnegative(),
});

export type RunMeta = z.infer<typeof RunMetaSchema>;
