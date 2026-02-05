import { randomBytes } from 'crypto';

/**
 * Generate a random alphanumeric string
 */
function randomAlphanumeric(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      result += chars[byte % chars.length];
    }
  }
  return result;
}

/**
 * Generate a run ID (format: run_<alphanumeric>)
 */
export function generateRunId(): string {
  return `run_${randomAlphanumeric(12)}`;
}

/**
 * Generate a span ID (format: sp_<alphanumeric>)
 */
export function generateSpanId(): string {
  return `sp_${randomAlphanumeric(12)}`;
}

/**
 * Generate a memory ID (format: mem_<alphanumeric>)
 */
export function generateMemoryId(): string {
  return `mem_${randomAlphanumeric(12)}`;
}

/**
 * Generate a step ID (format: step_<number>)
 */
export function generateStepId(stepNumber: number): string {
  return `step_${stepNumber.toString().padStart(4, '0')}`;
}
