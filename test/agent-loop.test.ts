import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../src/agent/loop.js";
import { MessageBus } from "../src/bus/message-bus.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
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

class ToolResultCaptureProvider implements LLMProvider {
  toolContent: string | null = null;

  getDefaultModel(): string {
    return "tool-result-capture";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const toolMessage = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool" && typeof message.content === "string");
    if (toolMessage && typeof toolMessage.content === "string") {
      this.toolContent = toolMessage.content;
      return {
        content: "Done",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: "tc_read",
          name: "read_file",
          arguments: {
            path: "large.txt",
          },
        },
      ],
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

  it("stops repeated workflow status polling and returns a visible status", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      {
        content: null,
        toolCalls: [
          {
            id: "tc_1",
            name: "query_workflow_status",
            arguments: { instance_id: "run_1" },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_2",
            name: "query_workflow_status",
            arguments: { instance_id: "run_1" },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_3",
            name: "query_workflow_status",
            arguments: { instance_id: "run_1" },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_4",
            name: "query_workflow_status",
            arguments: { instance_id: "run_1" },
          },
        ],
      },
      {
        content: null,
        toolCalls: [
          {
            id: "tc_5",
            name: "query_workflow_status",
            arguments: { instance_id: "run_1" },
          },
        ],
      },
    ]);
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    const response = await agent.processDirect({
      content: "继续查一下 run_1 的进度",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });
    expect(response).toContain("paused workflow status polling");
    expect(response).toContain("send the final result here when it completes");
  });

  it("does not forward speculative assistant text while tool calls are pending", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      {
        content: "I already know this is failing.",
        toolCalls: [
          {
            id: "tc_1",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
      {
        content: "Done",
        toolCalls: [],
      },
    ]);

    const progress: string[] = [];
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    await agent.processDirect({
      content: "check files",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
      onProgress: async (msg) => {
        progress.push(msg);
      },
    });

    expect(progress.some((msg) => msg.includes("I already know this is failing."))).toBe(false);
    expect(progress.some((msg) => msg.includes("list_dir"))).toBe(true);
  });

  it("emits structured main-agent trace events and mirrors them to progress when enabled", async () => {
    const workspace = await makeWorkspace();
    const provider = new ScriptedProvider([
      {
        content: "I will inspect the current directory first.",
        toolCalls: [
          {
            id: "tc_1",
            name: "list_dir",
            arguments: { path: "." },
          },
        ],
      },
      {
        content: "Done",
        toolCalls: [],
      },
    ]);
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.trace.enabled = true;
    config.agents.trace.level = "verbose";
    const bus = new MessageBus();
    const seenEvents: string[] = [];
    bus.onAgentTraceEvent((event) => {
      seenEvents.push(`${event.eventType}:${event.agentId}:${event.status}`);
    });

    const progress: string[] = [];
    const agent = new AgentLoop({
      bus,
      provider,
      workspace,
      appConfig: config,
    });

    await agent.processDirect({
      content: "check files",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
      onProgress: async (msg) => {
        progress.push(msg);
      },
    });

    expect(seenEvents).toContain("run:main:running");
    expect(seenEvents).toContain("iteration:main:running");
    expect(seenEvents).toContain("intent:main:info");
    expect(seenEvents).toContain("tool_call:main:running");
    expect(seenEvents.some((entry) => entry.startsWith("result:main:"))).toBe(true);
    expect(progress.some((msg) => msg.includes("[main][intent] I will inspect the current directory first."))).toBe(true);
    expect(progress.some((msg) => msg.includes("[main][tool_call] list_dir"))).toBe(true);
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
        isolation: {
          tenantId: "default",
          scopeOwners: {
            chat: "principal",
            papers: "conversation",
          },
        },
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
    expect(retrieveBody.user_id).toBe("tenant:default:principal:cli:user");
    expect(retrieveBody.agent_id).toBe("openintern-test:chat");
  });

  it("truncates large tool results before sending them back to the model", async () => {
    const workspace = await makeWorkspace();
    const provider = new ToolResultCaptureProvider();
    await writeFile(path.join(workspace, "large.txt"), "a".repeat(10_000), "utf8");

    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider,
      workspace,
    });

    const output = await agent.processDirect({
      content: "Read large.txt",
      sessionKey: "cli:test",
      channel: "cli",
      chatId: "test",
    });

    expect(output).toBe("Done");
    expect(provider.toolContent).not.toBeNull();
    expect(provider.toolContent?.length).toBeLessThan(4_200);
    expect(provider.toolContent).toContain("truncated for context");
  });
});
