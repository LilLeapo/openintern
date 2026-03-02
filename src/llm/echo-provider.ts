import type { ChatRequest, LLMProvider, LLMResponse } from "./provider.js";

export class EchoProvider implements LLMProvider {
  getDefaultModel(): string {
    return "echo-v1";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const userMessages = request.messages.filter((m) => m.role === "user");
    const last = userMessages[userMessages.length - 1];
    const raw = last?.content;
    const content = typeof raw === "string" ? raw : "OK";

    if (request.signal?.aborted) {
      throw new Error("Request aborted");
    }

    return {
      content: `Echo: ${content}`,
      toolCalls: [],
      finishReason: "stop",
    };
  }
}
