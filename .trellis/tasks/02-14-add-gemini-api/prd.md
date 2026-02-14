# Add Google Gemini API Support

## Goal

Add Google Gemini API as a new LLM provider, allowing users to use Gemini models (gemini-pro, gemini-pro-vision, etc.) alongside existing OpenAI and Anthropic providers.

## Background

Current LLM providers:
- OpenAI (gpt-4, gpt-3.5-turbo, etc.)
- Anthropic (claude-3-opus, claude-3-sonnet, etc.)
- Mock (for testing)

Users want to use Google Gemini models for:
- Cost optimization (Gemini pricing)
- Access to Gemini-specific features
- Multi-provider redundancy

## Requirements

### 1. Gemini Client Implementation

Create `src/backend/agent/gemini-client.ts` that implements `ILLMClient` interface:

```typescript
export class GeminiClient implements ILLMClient {
  async chat(messages: Message[], tools?: ToolDefinition[], options?: LLMCallOptions): Promise<LLMResponse>
  async *chatStream(messages: Message[], tools?: ToolDefinition[], options?: LLMCallOptions): AsyncIterable<LLMStreamChunk>
}
```

### 2. API Integration

**Gemini API Endpoint**:
- Base URL: `https://generativelanguage.googleapis.com/v1beta`
- Endpoint: `/models/{model}:generateContent`
- Authentication: API Key via query parameter `?key={apiKey}`

**Supported Models**:
- `gemini-pro` (text-only)
- `gemini-pro-vision` (multimodal)
- `gemini-1.5-pro` (latest)
- `gemini-1.5-flash` (faster, cheaper)

### 3. Message Format Conversion

Gemini uses a different message format than OpenAI/Anthropic:

**OpenAI/Anthropic format**:
```json
{
  "role": "user" | "assistant" | "system",
  "content": "text"
}
```

**Gemini format**:
```json
{
  "role": "user" | "model",
  "parts": [{"text": "content"}]
}
```

**Conversion rules**:
- `system` → prepend to first user message or use `systemInstruction` field
- `user` → `user`
- `assistant` → `model`
- `tool` → `function` response format

### 4. Tool Calling Support

Gemini supports function calling with this format:

**Request**:
```json
{
  "tools": [{
    "functionDeclarations": [{
      "name": "tool_name",
      "description": "description",
      "parameters": {
        "type": "object",
        "properties": {...}
      }
    }]
  }]
}
```

**Response**:
```json
{
  "candidates": [{
    "content": {
      "parts": [{
        "functionCall": {
          "name": "tool_name",
          "args": {...}
        }
      }]
    }
  }]
}
```

### 5. Streaming Support

Gemini streaming endpoint:
- Endpoint: `/models/{model}:streamGenerateContent`
- Returns: Server-Sent Events (SSE) with JSON chunks
- Each chunk contains partial response

### 6. Configuration

Add to `LLMConfig` type:

```typescript
type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'mock';

interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}
```

**Environment variables**:
- `GEMINI_API_KEY` - API key for Gemini
- `GEMINI_BASE_URL` - Optional custom base URL

### 7. Factory Function Update

Update `createLLMClient()` in `llm-client.ts`:

```typescript
export function createLLMClient(config: LLMConfig): ILLMClient {
  switch (config.provider) {
    case 'mock':
      return new MockLLMClient(config);
    case 'openai':
      return new OpenAIClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    case 'gemini':
      return new GeminiClient(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
```

## Implementation Details

### Message Mapping

```typescript
private mapMessage(msg: Message): GeminiMessage {
  // Handle system messages
  if (msg.role === 'system') {
    // Store for systemInstruction field
    return null; // Don't include in messages array
  }

  // Map roles
  const role = msg.role === 'assistant' ? 'model' : 'user';

  // Handle tool calls
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    return {
      role: 'model',
      parts: msg.toolCalls.map(tc => ({
        functionCall: {
          name: tc.name,
          args: tc.parameters
        }
      }))
    };
  }

  // Handle tool results
  if (msg.role === 'tool') {
    return {
      role: 'function',
      parts: [{
        functionResponse: {
          name: msg.name,
          response: { result: msg.content }
        }
      }]
    };
  }

  // Regular message
  return {
    role,
    parts: [{ text: msg.content }]
  };
}
```

### Tool Mapping

```typescript
private mapTool(tool: ToolDefinition): GeminiTool {
  return {
    functionDeclarations: [{
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }]
  };
}
```

### Response Parsing

```typescript
private parseResponse(data: GeminiResponse): LLMResponse {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new LLMError('No candidates in Gemini response', 'gemini');
  }

  const parts = candidate.content?.parts || [];

  // Extract text content
  const textParts = parts.filter(p => p.text);
  const content = textParts.map(p => p.text).join('');

  // Extract tool calls
  const functionCalls = parts.filter(p => p.functionCall);
  const toolCalls = functionCalls.map(p => ({
    id: `tc_${Date.now()}_${Math.random()}`,
    name: p.functionCall.name,
    parameters: p.functionCall.args
  }));

  // Extract usage
  const usage = {
    promptTokens: data.usageMetadata?.promptTokenCount || 0,
    completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
    totalTokens: data.usageMetadata?.totalTokenCount || 0
  };

  return {
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage
  };
}
```

### Streaming Implementation

```typescript
async *chatStream(
  messages: Message[],
  tools?: ToolDefinition[],
  options?: LLMCallOptions
): AsyncIterable<LLMStreamChunk> {
  const body = this.buildRequestBody(messages, tools);

  const response = await fetch(
    `${this.baseUrl}/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options?.signal
    }
  );

  if (!response.ok) {
    throw new LLMError(`Gemini API error: ${response.status}`, 'gemini');
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new LLMError('No response body', 'gemini');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim() || !line.startsWith('data: ')) continue;

      const jsonStr = line.slice(6); // Remove 'data: ' prefix
      if (jsonStr === '[DONE]') continue;

      try {
        const chunk = JSON.parse(jsonStr);
        const delta = this.extractDelta(chunk);

        yield {
          delta,
          done: false
        };
      } catch (err) {
        // Skip invalid JSON
      }
    }
  }

  yield { delta: '', done: true };
}
```

## Error Handling

### Common Errors

| Error | Cause | Handling |
|-------|-------|----------|
| 400 Bad Request | Invalid request format | Throw LLMError with details |
| 401 Unauthorized | Invalid API key | Throw LLMError, suggest checking GEMINI_API_KEY |
| 429 Rate Limit | Too many requests | Throw LLMError with retry suggestion |
| 500 Server Error | Gemini service issue | Throw LLMError, suggest retry |

### Safety Ratings

Gemini may block responses due to safety filters:

```typescript
if (candidate.finishReason === 'SAFETY') {
  const safetyRatings = candidate.safetyRatings || [];
  const blocked = safetyRatings.filter(r => r.blocked);
  throw new LLMError(
    `Response blocked by safety filters: ${blocked.map(r => r.category).join(', ')}`,
    'gemini'
  );
}
```

## Testing

### Unit Tests

Create `src/backend/agent/gemini-client.test.ts`:

```typescript
describe('GeminiClient', () => {
  it('should map messages correctly', () => {
    // Test message format conversion
  });

  it('should map tools correctly', () => {
    // Test tool format conversion
  });

  it('should parse response correctly', () => {
    // Test response parsing
  });

  it('should handle tool calls', () => {
    // Test tool call flow
  });

  it('should handle streaming', async () => {
    // Test streaming response
  });

  it('should handle errors', async () => {
    // Test error handling
  });
});
```

### Integration Tests

Test with real Gemini API (requires API key):

```bash
export GEMINI_API_KEY="your-api-key"
pnpm test gemini-client.test.ts
```

### Manual Testing

```bash
# Update agent.config.json
{
  "llm": {
    "provider": "gemini",
    "model": "gemini-1.5-flash",
    "temperature": 0.7
  }
}

# Run CLI
pnpm cli run "Hello, test Gemini API"
```

## Acceptance Criteria

- [ ] `GeminiClient` class implements `ILLMClient` interface
- [ ] Message format conversion works correctly
- [ ] Tool calling works (function declarations and responses)
- [ ] Streaming works and yields incremental tokens
- [ ] Error handling covers common API errors
- [ ] Safety filter blocks are handled gracefully
- [ ] Unit tests pass
- [ ] Integration tests pass (with real API key)
- [ ] TypeScript types are correct
- [ ] No lint errors
- [ ] Documentation updated (README, API docs)

## Configuration Example

**agent.config.json**:
```json
{
  "llm": {
    "provider": "gemini",
    "model": "gemini-1.5-flash",
    "apiKey": "your-api-key-here",
    "temperature": 0.7,
    "maxTokens": 2048
  }
}
```

**Environment variables**:
```bash
export GEMINI_API_KEY="your-api-key"
export GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta"  # optional
```

## References

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Gemini API Reference](https://ai.google.dev/api/rest)
- [Function Calling Guide](https://ai.google.dev/docs/function_calling)
- [Streaming Guide](https://ai.google.dev/docs/streaming)

## Non-Goals

- ❌ Multimodal support (images, audio) - text-only for now
- ❌ Gemini-specific features (grounding, code execution) - basic chat only
- ❌ Fine-tuned models - use standard models only
- ❌ Batch API - single requests only

## Future Enhancements

- Support for multimodal inputs (images)
- Gemini grounding (search integration)
- Code execution feature
- Batch API support
- Model tuning integration
