import { z } from 'zod';

/**
 * Tool call schema for checkpoint messages
 */
const CheckpointToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  parameters: z.record(z.unknown()),
});

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
      /** Tool call ID for tool result messages */
      toolCallId: z.string().optional(),
      /** Tool calls for assistant messages */
      toolCalls: z.array(CheckpointToolCallSchema).optional(),
    })),
    /** Current context */
    context: z.record(z.unknown()).optional(),
  }),
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;
