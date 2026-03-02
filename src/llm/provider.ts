export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCallRequest[];
  finishReason?: string;
  usage?: Record<string, number>;
  reasoningContent?: string | null;
  thinkingBlocks?: Array<Record<string, unknown>>;
}

export interface ChatRequest {
  messages: Array<Record<string, unknown>>;
  tools?: Array<Record<string, unknown>>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string | null;
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(request: ChatRequest): Promise<LLMResponse>;
  getDefaultModel(): string;
}

