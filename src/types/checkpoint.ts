import { z } from 'zod';

/**
 * Checkpoint schema - agent state snapshot for recovery
 */
export const CheckpointSchema = z.object({
  /** Schema version */
  v: z.literal(1),
  /** Checkpoint creation timestamp */
  created_at: z.string().datetime(),
  /** Run identifier */
  run_id: z.string().regex(/^run_[a-zA-Z0-9]+$/),
  /** Step identifier at checkpoint time */
  step_id: z.string().regex(/^step_[0-9]+$/),
  /** Agent state data */
  state: z.object({
    /** Conversation messages */
    messages: z.array(z.object({
      role: z.enum(['user', 'assistant', 'system', 'tool']),
      content: z.string(),
    })),
    /** Current context */
    context: z.record(z.unknown()).optional(),
  }),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;
