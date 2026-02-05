/**
 * Base error class for all agent system errors
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Error for EventStore operations
 */
export class EventStoreError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EVENT_STORE_ERROR', 500, details);
    this.name = 'EventStoreError';
  }
}

/**
 * Error for CheckpointStore operations
 */
export class CheckpointStoreError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CHECKPOINT_STORE_ERROR', 500, details);
    this.name = 'CheckpointStoreError';
  }
}

/**
 * Error for MemoryStore operations
 */
export class MemoryStoreError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'MEMORY_STORE_ERROR', 500, details);
    this.name = 'MemoryStoreError';
  }
}

/**
 * Error for ProjectionStore operations
 */
export class ProjectionStoreError extends AgentError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PROJECTION_STORE_ERROR', 500, details);
    this.name = 'ProjectionStoreError';
  }
}

/**
 * Error for tool operations
 */
export class ToolError extends AgentError {
  constructor(
    message: string,
    public toolName: string,
    details?: Record<string, unknown>
  ) {
    super(message, 'TOOL_ERROR', 500, { ...details, toolName });
    this.name = 'ToolError';
  }
}

/**
 * Error for validation failures
 */
export class ValidationError extends AgentError {
  constructor(message: string, public field: string) {
    super(message, 'VALIDATION_ERROR', 400, { field });
    this.name = 'ValidationError';
  }
}

/**
 * Error for resource not found
 */
export class NotFoundError extends AgentError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}
