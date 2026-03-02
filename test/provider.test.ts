import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { makeProvider } from "../src/llm/provider-factory.js";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible-provider.js";

describe("provider factory", () => {
  it("throws when api key is missing", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.openaiCompatible.apiKey = "";
    expect(() => makeProvider(config)).toThrow("No API key configured");
  });
});

describe("openai compatible provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses normal response and tool calls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "tc_1",
                      function: {
                        name: "read_file",
                        arguments: "{\"path\":\"README.md\"}",
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 2 },
          }),
        };
      }),
    );

    const provider = new OpenAICompatibleProvider({
      apiKey: "k",
      apiBase: "http://localhost:1234/v1",
      defaultModel: "gpt-4o-mini",
    });
    const response = await provider.chat({
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
    expect(response.finishReason).toBe("tool_calls");
    expect(response.toolCalls[0]?.name).toBe("read_file");
    expect(response.toolCalls[0]?.arguments.path).toBe("README.md");
  });

  it("returns finish_reason=error on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: async () => "invalid key",
        };
      }),
    );

    const provider = new OpenAICompatibleProvider({
      apiKey: "bad",
      apiBase: "http://localhost:1234/v1",
      defaultModel: "gpt-4o-mini",
    });
    const response = await provider.chat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(response.finishReason).toBe("error");
    expect(response.content).toContain("HTTP 401");
  });
});

