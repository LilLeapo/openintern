import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMemuUserId, resolveMemoryIdentity } from "../src/agent/memory/identity.js";
import { MemUClient } from "../src/agent/memory/memu-client.js";
import { MemoryDeleteTool, MemoryRetrieveTool, MemorySaveTool } from "../src/tools/builtins/memory.js";
import { ScopedMemoryRetrieveTool, ScopedMemorySaveTool } from "../src/tools/builtins/scoped-memory.js";

function resolver(input: {
  channel: string;
  chatId: string;
  senderId: string;
  metadata?: Record<string, unknown>;
  scope: "chat" | "papers";
}): {
  userId: string;
  agentId: string;
} {
  const identity = resolveMemoryIdentity(
    input,
    {
      isolation: {
        tenantId: "default",
        scopeOwners: {
          chat: "principal",
          papers: "conversation",
        },
      },
      memu: {
        enabled: true,
        apiKey: "",
        baseUrl: "",
        agentId: "openintern",
        scopes: {
          chat: "chat",
          papers: "papers",
        },
        timeoutMs: 1_000,
        retrieve: true,
        memorize: true,
        memorizeMode: "tool",
        apiStyle: "cloudV3",
        endpoints: {},
      },
    },
  );
  return {
    userId: buildMemuUserId(identity),
    agentId: `openintern:${input.scope}`,
  };
}

describe("memory tools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("memory_save stores chat memory under the sender principal", async () => {
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
    tool.setContext("cli", "direct", undefined, "alice");

    const output = await tool.execute({
      content: "User prefers concise responses.",
      scope: "chat",
    });

    expect(output).toContain("Saved memory to chat scope");
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(call[0]).toBe("https://api.memu.so/api/v3/memory/memorize");
    const body = JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
    expect(body.user_id).toBe("tenant:default:principal:cli:alice");
    expect(body.agent_id).toBe("openintern:chat");
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

  it("scoped memory tools force role scope regardless of requested scope", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const agentId = String(payload.agent_id ?? "");
      if (_url.endsWith("/api/v3/memory/memorize")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ task_id: "task_2", agent_id: agentId }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [{ summary: `Retrieved from ${agentId}` }],
          }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new MemUClient({
      apiKey: "k",
      baseUrl: "https://api.memu.so",
    });

    const saveTool = new ScopedMemorySaveTool(client, resolver, "papers");
    saveTool.setContext("cli", "direct");
    const saveOutput = await saveTool.execute({
      content: "Should be stored in papers scope only.",
      scope: "chat",
    });
    expect(saveOutput).toContain("papers scope");

    const saveCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/v3/memory/memorize"),
    ) as [string, RequestInit | undefined];
    const saveBody = JSON.parse(String(saveCall[1]?.body ?? "{}")) as Record<string, unknown>;
    expect(saveBody.agent_id).toBe("openintern:papers");

    const retrieveTool = new ScopedMemoryRetrieveTool(client, resolver, "chat");
    retrieveTool.setContext("cli", "direct");
    const retrieveOutput = await retrieveTool.execute({
      query: "where is this from?",
      scope: "all",
    });
    expect(retrieveOutput).toContain("openintern:chat");

    const retrieveCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/v3/memory/retrieve"),
    );
    expect(retrieveCalls).toHaveLength(1);
  });
});
