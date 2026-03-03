import { afterEach, describe, expect, it, vi } from "vitest";

import { MemUClient } from "../src/agent/memory/memu-client.js";
import { MemoryDeleteTool, MemoryRetrieveTool, MemorySaveTool } from "../src/tools/builtins/memory.js";

function resolver(input: { channel: string; chatId: string; scope: "chat" | "papers" }): {
  userId: string;
  agentId: string;
} {
  return {
    userId: `${input.channel}:${input.chatId}`,
    agentId: `openintern:${input.scope}`,
  };
}

describe("memory tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("memory_save stores content in selected scope", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ task_id: "task_1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
    });
    const tool = new MemorySaveTool(client, resolver);
    tool.setContext("cli", "direct");

    const output = await tool.execute({
      content: "User prefers concise responses.",
      scope: "papers",
    });

    expect(output).toContain("Saved memory to papers scope");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(call[0]).toBe("https://api.memu.so/api/v3/memory/memorize");
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    expect(body.user_id).toBe("cli:direct");
    expect(body.agent_id).toBe("openintern:papers");
  });

  it("memory_retrieve can merge chat and papers scopes", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const agentId = String(payload.agent_id ?? "");
      if (agentId.endsWith(":chat")) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [{ summary: "Chat memory item." }],
            }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [{ summary: "Paper memory item." }],
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
    });
    const tool = new MemoryRetrieveTool(client, resolver);
    tool.setContext("cli", "direct");

    const output = await tool.execute({
      query: "what should I remember?",
      scope: "all",
    });

    expect(output).toContain("# Scope: chat");
    expect(output).toContain("# Scope: papers");
    expect(output).toContain("Chat memory item.");
    expect(output).toContain("Paper memory item.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("memory_delete reports unsupported when clear endpoint is unavailable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
    });
    const tool = new MemoryDeleteTool(client, resolver);
    tool.setContext("cli", "direct");

    const output = await tool.execute({
      scope: "chat",
    });

    expect(output).toContain("unsupported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
