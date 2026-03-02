import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { makeProvider } from "../src/llm/provider-factory.js";
import { AnthropicCompatibleProvider } from "../src/llm/anthropic-compatible-provider.js";
import { OpenAICompatibleProvider } from "../src/llm/openai-compatible-provider.js";

describe("provider factory", () => {
  it("throws when api key is missing", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.providers.openaiCompatible.apiKey = "";
    config.providers.anthropicCompatible.apiKey = "";
    expect(() => makeProvider(config)).toThrow("No API key configured");
  });

  it("auto-selects anthropic for claude model when anthropic key exists", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.defaults.model = "claude-3-7-sonnet-latest";
    config.providers.anthropicCompatible.apiKey = "anthropic-key";
    const provider = makeProvider(config);
    expect(provider).toBeInstanceOf(AnthropicCompatibleProvider);
  });

  it("respects forced openai provider", () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.defaults.provider = "openaiCompatible";
    config.providers.openaiCompatible.apiKey = "openai-key";
    config.providers.anthropicCompatible.apiKey = "anthropic-key";
    const provider = makeProvider(config);
    expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
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

describe("anthropic compatible provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses text + tool_use blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: true,
          json: async () => ({
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "let me call a tool" },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "read_file",
                input: { path: "README.md" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 4 },
          }),
        };
      }),
    );

    const provider = new AnthropicCompatibleProvider({
      apiKey: "ak",
      apiBase: "https://api.anthropic.com/v1",
      defaultModel: "claude-3-7-sonnet-latest",
    });
    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
      tools: [
        {
          type: "function",
          function: {
            name: "read_file",
            description: "Read file",
            parameters: { type: "object", properties: {}, required: [] },
          },
        },
      ],
    });
    expect(res.finishReason).toBe("tool_use");
    expect(res.content).toContain("let me call");
    expect(res.toolCalls[0]?.name).toBe("read_file");
    expect(res.toolCalls[0]?.arguments.path).toBe("README.md");
  });

  it("returns finish_reason=error on non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: async () => "bad key",
        };
      }),
    );

    const provider = new AnthropicCompatibleProvider({
      apiKey: "bad",
      apiBase: "https://api.anthropic.com/v1",
      defaultModel: "claude-3-7-sonnet-latest",
    });
    const res = await provider.chat({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(res.finishReason).toBe("error");
    expect(res.content).toContain("HTTP 403");
  });
});
