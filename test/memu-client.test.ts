import { afterEach, describe, expect, it, vi } from "vitest";

import { MemUClient } from "../src/agent/memory/memu-client.js";

describe("MemUClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retrieves memory and formats context", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        categories: [{ name: "preferences", summary: "Prefers concise answers." }],
        items: [{ summary: "User likes TypeScript and strict mode." }],
        resources: [{ resource_url: "conv_20260303.json" }],
        next_step_query: "Ask about coding style examples.",
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "memu-key",
      baseUrl: "https://api.memu.so",
      timeoutMs: 3_000,
    });

    const result = await client.retrieve({
      query: "What should I remember about this user?",
      userId: "cli:direct",
      agentId: "openintern",
    });

    expect(result.categories).toHaveLength(1);
    expect(result.items).toHaveLength(1);
    expect(result.resources).toHaveLength(1);
    expect(result.nextStepQuery).toContain("coding style");

    const formatted = MemUClient.formatRetrieveContext(result);
    expect(formatted).toContain("Related Categories");
    expect(formatted).toContain("Relevant Memory Items");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const url = String(firstCall[0]);
    const init = firstCall[1] ?? {};
    expect(url).toBe("https://api.memu.so/api/v3/memory/retrieve");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer memu-key");
  });

  it("memorizes conversation and returns task id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ task_id: "task_123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
    });

    const response = await client.memorizeConversation({
      userId: "cli:direct",
      agentId: "openintern",
      conversation: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ],
    });

    expect(response.taskId).toBe("task_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const url = String(firstCall[0]);
    const init = firstCall[1] ?? {};
    expect(url).toBe("https://api.memu.so/api/v3/memory/memorize");
    expect(init.method).toBe("POST");
  });

  it("throws timeout error when request exceeds timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
      timeoutMs: 20,
    });

    await expect(
      client.retrieve({
        query: "slow request",
        userId: "cli:direct",
        agentId: "openintern",
      }),
    ).rejects.toThrow("timed out");
  });
});
