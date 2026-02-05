import { z } from 'zod';

/**
 * Memory item schema - for storing memory items
 */
export const MemoryItemSchema = z.object({
  /** Memory item identifier */
  id: z.string().regex(/^mem_[a-zA-Z0-9]+$/),
  /** Creation timestamp */
  created_at: z.string().datetime(),
  /** Last updated timestamp */
  updated_at: z.string().datetime(),
  /** Memory content */
  content: z.string(),
  /** Keywords for search */
  keywords: z.array(z.string()),
  /** Optional metadata */
  metadata: z.record(z.unknown()).optional(),
});

export type MemoryItem = z.infer<typeof MemoryItemSchema>;
