import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../src/agent/loop.js";
import { MessageBus } from "../src/bus/message-bus.js";
import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";

class ScriptedProvider implements LLMProvider {
  private index = 0;

  constructor(private readonly responses: LLMResponse[]) {}

  getDefaultModel(): string {
    return "scripted";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    const next = this.responses[this.index];
    if (!next) {
      return {
        content: "Done",
        toolCalls: [],
      };
    }
    this.index += 1;
    return next;
  }
}

class WaitingProvider implements LLMProvider {
  getDefaultModel(): string {
    return "waiting";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 200);
      request.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
    return {
      content: "Late response",
      toolCalls: [],
    };
  }
}

class CapturingProvider implements LLMProvider {
  lastRequest: ChatRequest | null = null;

  getDefaultModel(): string {
    return "capturing";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    this.lastRequest = request;
    return {
      content: "MemU-aware answer",
      toolCalls: [],
    };
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-loop-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("AgentLoop", () => {
  it("runs tool-call loop and returns final content", async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace, "hello.txt"), "world", "utf8");

    const provider = new ScriptedProvider([
      {
        content: null,
        toolCalls: [
          {
            id: "tc_1",
            name: "read_file",
            arguments: { path: "hello.txt" },
          },
        ],
      },
      {
        content: "Read complete",
        toolCalls: [],
      },
    ]);

    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    const output = await agent.processDirect({
      content: "Read hello.txt",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(output).toBe("Read complete");
  });

  it("supports /new command and clears session", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      { content: "Hi", toolCalls: [] },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_mem_1",
            name: "save_memory",
            arguments: {
              history_entry: "[2026-03-02 00:00] talked",
              memory_update: "# Memory\n- user said hello",
            },
          },
        ],
      },
    ]);
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    await agent.processDirect({
      content: "hello",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    const reset = await agent.processDirect({
      content: "/new",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(reset).toBe("New session started.");

    const sessionFile = path.join(workspace, "sessions", "cli_test.jsonl");
    const raw = await readFile(sessionFile, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"last_consolidated":0');
  });

  it("keeps session when /new archival fails", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      { content: "Hi", toolCalls: [] },
      { content: "No save tool call", toolCalls: [] },
    ]);
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    await agent.processDirect({
      content: "hello",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    const reset = await agent.processDirect({
      content: "/new",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(reset).toContain("Memory archival failed");
  });

  it("returns max-iteration fallback when tool loop never ends", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      {
        content: null,
        toolCalls: [
          {
            id: "tc_1",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_2",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_3",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
    ]);
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
      maxIterations: 2,
    });

    const response = await agent.processDirect({
      content: "Loop forever",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(response).toContain("maximum number of tool call iterations (2)");
  });

  it("handles /stop and aborts active session task", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const provider = new WaitingProvider();
    const agent = new AgentLoop({
      bus,
      provider,
      workspace,
    });

    const runPromise = agent.run();
    await bus.publishInbound({
      channel: "cli",
      senderId: "u1",
      chatId: "chat-1",
      content: "long task",
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    await bus.publishInbound({
      channel: "cli",
      senderId: "u1",
      chatId: "chat-1",
      content: "/stop",
    });

    const outbound1 = await bus.consumeOutbound(1000);
    const outbound2 = await bus.consumeOutbound(1000);
    const outputs = [outbound1?.content ?? "", outbound2?.content ?? ""].join("\n");
    expect(outputs).toContain("Stopped 1 task(s).");

    agent.stop();
    await runPromise;
  });

  it("injects MemU retrieval into prompt and memorizes turn asynchronously", async () => {
    const workspace = await makeWorkspace();
    const provider = new CapturingProvider();
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/api/v3/memory/retrieve")) {
        return {
          ok: true,
          json: async () => ({
            categories: [{ name: "preferences", summary: "Communication preferences." }],
            items: [{ summary: "User prefers concise diffs." }],
            resources: [{ resource_url: "conv_001.json" }],
          }),
        };
      }
      if (url.endsWith("/api/v3/memory/memorize")) {
        return {
          ok: true,
          json: async () => ({ task_id: "task_1" }),
        };
      }
      return {
        ok: true,
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
      memoryConfig: {
        memu: {
          enabled: true,
          apiKey: "memu-key",
          baseUrl: "https://api.memu.so",
          agentId: "openintern-test",
          scopes: {
            chat: "chat",
            papers: "papers",
          },
          timeoutMs: 3000,
          retrieve: true,
          memorize: true,
          memorizeMode: "auto",
          apiStyle: "cloudV3",
          endpoints: {},
        },
      },
    });

    const output = await agent.processDirect({
      content: "How should you respond to me?",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(output).toBe("MemU-aware answer");

    const systemMessages = (provider.lastRequest?.messages ?? []).filter(
      (message) => message.role === "system",
    );
    const injected = systemMessages.some((message) => {
      const content = message.content;
      return typeof content === "string" && content.includes("External Memory Context");
    });
    expect(injected).toBe(true);

    const deadline = Date.now() + 1000;
    let memorizeCalled = false;
    while (Date.now() < deadline) {
      memorizeCalled = fetchMock.mock.calls.some(([url]) =>
        String(url).endsWith("/api/v3/memory/memorize"),
      );
      if (memorizeCalled) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(memorizeCalled).toBe(true);

    const retrieveCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/v3/memory/retrieve"),
    );
    const retrieveBodyRaw = (retrieveCall?.[1] as RequestInit | undefined)?.body;
    expect(typeof retrieveBodyRaw).toBe("string");
    const retrieveBody = JSON.parse(String(retrieveBodyRaw)) as Record<string, unknown>;
    expect(retrieveBody.user_id).toBe("cli:test");
    expect(retrieveBody.agent_id).toBe("openintern-test:chat");
  });
});
