import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SubagentManager } from "../src/agent/subagent/manager.js";
import { MessageBus } from "../src/bus/message-bus.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";
import { MemUClient } from "../src/agent/memory/memu-client.js";
import { Tool } from "../src/tools/core/tool.js";
import { ToolRegistry } from "../src/tools/core/tool-registry.js";

class StaticProvider implements LLMProvider {
  constructor(private readonly content: string) {}

  getDefaultModel(): string {
    return "static";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    return {
      content: this.content,
      toolCalls: [],
    };
  }
}

class BlockingProvider implements LLMProvider {
  getDefaultModel(): string {
    return "blocking";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 10_000);
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
      content: "done",
      toolCalls: [],
    };
  }
}

class DelayedProvider implements LLMProvider {
  active = 0;
  maxActive = 0;

  constructor(private readonly delayMs: number) {}

  getDefaultModel(): string {
    return "delayed";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    this.active -= 1;
    return {
      content: "done",
      toolCalls: [],
    };
  }
}

class TraversalProvider implements LLMProvider {
  getDefaultModel(): string {
    return "traversal";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const latestTool = [...request.messages]
      .reverse()
      .find((message) => message.role === "tool" && message.name === "write_file");
    if (latestTool && typeof latestTool.content === "string") {
      return {
        content: latestTool.content,
        toolCalls: [],
      };
    }

    return {
      content: null,
      toolCalls: [
        {
          id: "tc_write_1",
          name: "write_file",
          arguments: {
            path: "../../escape.txt",
            content: "unsafe",
          },
        },
      ],
    };
  }
}

class CapturingToolsProvider implements LLMProvider {
  public toolNames: string[] = [];

  getDefaultModel(): string {
    return "capture-tools";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    this.toolNames = (request.tools ?? [])
      .map((toolDef) => {
        const toolObj =
          typeof toolDef === "object" && toolDef !== null
            ? (toolDef as Record<string, unknown>)
            : null;
        const fnObj =
          toolObj && typeof toolObj.function === "object" && toolObj.function !== null
            ? (toolObj.function as Record<string, unknown>)
            : null;
        return typeof fnObj?.name === "string" ? fnObj.name : "";
      })
      .filter((name) => name.length > 0);
    return {
      content: "ok",
      toolCalls: [],
    };
  }
}

class BatchApprovalProvider implements LLMProvider {
  getDefaultModel(): string {
    return "batch-approval";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const hasWrite = request.messages.some(
      (message) => message.role === "tool" && message.name === "write_file",
    );
    const hasExec = request.messages.some(
      (message) => message.role === "tool" && message.name === "exec",
    );
    if (hasWrite && hasExec) {
      return {
        content: "{\"ok\":true}",
        toolCalls: [],
      };
    }

    return {
      content: null,
      toolCalls: [
        {
          id: "tc_write",
          name: "write_file",
          arguments: {
            path: "atomic.txt",
            content: "atomic",
          },
        },
        {
          id: "tc_exec",
          name: "exec",
          arguments: {
            command: "echo hitl",
          },
        },
      ],
    };
  }
}

class HighRiskOnlyProvider implements LLMProvider {
  getDefaultModel(): string {
    return "high-risk-only";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const hasExec = request.messages.some(
      (message) => message.role === "tool" && message.name === "exec",
    );
    if (hasExec) {
      return {
        content: "{\"ok\":true}",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: "tc_exec",
          name: "exec",
          arguments: {
            command: "echo gated",
          },
        },
      ],
    };
  }
}

class ExternalMcpProvider implements LLMProvider {
  getDefaultModel(): string {
    return "external-mcp";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const hasToolResult = request.messages.some(
      (message) => message.role === "tool" && message.name === "lark-mcp__wiki_query",
    );
    if (hasToolResult) {
      return {
        content: "{\"ok\":true}",
        toolCalls: [],
      };
    }
    return {
      content: null,
      toolCalls: [
        {
          id: "tc_mcp_1",
          name: "lark-mcp__wiki_query",
          arguments: {
            q: "AEM",
          },
        },
      ],
    };
  }
}

class FakeExternalMcpTool extends Tool {
  readonly name = "lark-mcp__wiki_query";
  readonly description = "fake mcp query";
  readonly parameters = {
    type: "object",
    properties: {
      q: {
        type: "string",
      },
    },
    required: ["q"],
  } as const;

  async execute(params: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      summary: `mcp:${String(params.q ?? "")}`,
    });
  }
}

const tempDirs: string[] = [];

function makeConfig() {
  return structuredClone(DEFAULT_CONFIG);
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "subagent-manager-test-"));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 1500,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timeout");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("SubagentManager", () => {
  it("announces completion and emits subagent event", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const seenEvents: string[] = [];
    bus.onSubagentEvent((event) => {
      seenEvents.push(event.type);
    });

    const manager = new SubagentManager({
      provider: new StaticProvider("sub done"),
      workspace,
      bus,
      model: "static",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    const ack = await manager.spawn({
      task: "quick task",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    expect(ack).toContain("started");

    const inbound = await bus.consumeInbound(1000);
    expect(inbound?.channel).toBe("system");
    expect(inbound?.senderId).toBe("subagent");
    expect(inbound?.content).toContain("sub done");
    expect(seenEvents).toContain("SUBAGENT_TASK_COMPLETED");
  });

  it("cancels running subagents by session", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const manager = new SubagentManager({
      provider: new BlockingProvider(),
      workspace,
      bus,
      model: "blocking",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    await manager.spawn({
      task: "long task",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    const cancelled = await manager.cancelBySession("cli:direct");
    expect(cancelled).toBe(1);
  });

  it("spawnTask returns structured result and can suppress system callback", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const seenEvents: string[] = [];
    bus.onSubagentEvent((event) => {
      seenEvents.push(event.type);
    });

    const manager = new SubagentManager({
      provider: new StaticProvider("{\"ok\":true}"),
      workspace,
      bus,
      model: "static",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    const started = await manager.spawnTask({
      task: "structured run",
      originChannel: "workflow",
      originChatId: "run_1:node_1",
      sessionKey: "workflow:run_1:node_1:1",
      announceToMainAgent: false,
    });

    expect(started.taskId).toMatch(/^[a-f0-9]{8}$/);
    expect(started.ack).toContain("started");
    expect(started.queued).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const inbound = await bus.consumeInbound(100);
    expect(inbound).toBeNull();
    expect(seenEvents).toContain("SUBAGENT_TASK_COMPLETED");
  });

  it("returns error for unknown role", async () => {
    const workspace = await makeWorkspace();
    const manager = new SubagentManager({
      provider: new StaticProvider("ok"),
      workspace,
      bus: new MessageBus(),
      model: "static",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    const ack = await manager.spawn({
      task: "x",
      role: "missing-role",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });

    expect(ack).toContain("Unknown role");
  });

  it("queues tasks when max concurrency is reached", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const provider = new DelayedProvider(80);
    const manager = new SubagentManager({
      provider,
      workspace,
      bus,
      model: "delayed",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
      maxConcurrent: 2,
    });

    const ack1 = await manager.spawn({
      task: "task-1",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    const ack2 = await manager.spawn({
      task: "task-2",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    const ack3 = await manager.spawn({
      task: "task-3",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });

    expect(ack1).toContain("started");
    expect(ack2).toContain("started");
    expect(ack3).toContain("queued");

    const inboundMessages = [
      await bus.consumeInbound(2000),
      await bus.consumeInbound(2000),
      await bus.consumeInbound(2000),
    ];
    expect(inboundMessages.filter(Boolean)).toHaveLength(3);
    expect(provider.maxActive).toBeLessThanOrEqual(2);
  });

  it("applies role tool whitelist in request tool definitions", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const provider = new CapturingToolsProvider();
    const manager = new SubagentManager({
      provider,
      workspace,
      bus,
      model: "capture-tools",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
      memuClient: new MemUClient({
        apiKey: "k",
        baseUrl: "https://api.memu.so",
      }),
      memuScopeResolver: ({ channel, chatId, scope }) => ({
        userId: `${channel}:${chatId}`,
        agentId: `openintern:${scope}`,
      }),
    });

    await manager.spawn({
      task: "Research papers on transformers",
      role: "researcher",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });

    await bus.consumeInbound(1000);
    expect(provider.toolNames.sort()).toEqual([
      "memory_retrieve",
      "memory_save",
      "web_fetch",
      "web_search",
    ]);
  });

  it("enforces workspace isolation for role-based file writes", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const manager = new SubagentManager({
      provider: new TraversalProvider(),
      workspace,
      bus,
      model: "traversal",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    const ack = await manager.spawn({
      task: "Try writing outside workspace sandbox",
      role: "scientist",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    expect(ack).toContain("started");

    const taskIdMatch = ack.match(/id: ([a-f0-9]+)/);
    expect(taskIdMatch).not.toBeNull();
    const taskId = taskIdMatch?.[1] ?? "";
    const isolatedDir = path.join(workspace, "tasks", taskId);
    const escapedPath = path.join(workspace, "escape.txt");

    const inbound = await bus.consumeInbound(1500);
    expect(inbound?.content).toContain("Access denied");
    expect(await pathExists(isolatedDir)).toBe(true);
    expect(await pathExists(escapedPath)).toBe(false);
  });

  it("atomically gates a whole tool-call batch when any high-risk tool is present", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const requested: string[] = [];
    const completed: string[] = [];
    bus.onSubagentApprovalRequested((event) => {
      requested.push(event.approvalId);
      expect(event.toolCalls).toHaveLength(2);
      expect(event.toolCalls.some((toolCall) => toolCall.name === "exec" && toolCall.highRisk)).toBe(true);
      expect(event.toolCalls.some((toolCall) => toolCall.name === "write_file" && !toolCall.highRisk)).toBe(true);
    });
    bus.onSubagentEvent((event) => {
      completed.push(event.type);
    });

    const manager = new SubagentManager({
      provider: new BatchApprovalProvider(),
      workspace,
      bus,
      model: "batch-approval",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    const started = await manager.spawnTask({
      task: "run hitl batch",
      originChannel: "workflow",
      originChatId: "run_a:node_a",
      sessionKey: "workflow:run_a:node_a:1",
      announceToMainAgent: false,
      workflowContext: {
        runId: "run_a",
        nodeId: "node_a",
        nodeName: "node_a",
        hitl: {
          enabled: true,
          highRiskTools: ["exec"],
          approvalTarget: "owner",
          approvalTimeoutMs: 2_000,
        },
      },
    });

    await waitFor(() => requested.length === 1);
    const beforeApproval = await pathExists(path.join(workspace, "atomic.txt"));
    expect(beforeApproval).toBe(false);

    await bus.emitSubagentApprovalGranted({
      type: "SUBAGENT_APPROVAL_GRANTED",
      approvalId: requested[0] ?? "",
      taskId: started.taskId,
      approver: "reviewer",
      approvedAt: new Date(),
    });

    await waitFor(() => completed.includes("SUBAGENT_TASK_COMPLETED"), 3000);
    const afterApproval = await pathExists(path.join(workspace, "atomic.txt"));
    expect(afterApproval).toBe(true);
  });

  it("emits approval timeout and fails the task", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const expired: string[] = [];
    const failed: string[] = [];
    bus.onSubagentApprovalExpired((event) => {
      expired.push(event.approvalId);
    });
    bus.onSubagentEvent((event) => {
      if (event.type === "SUBAGENT_TASK_FAILED") {
        failed.push(event.taskId);
      }
    });

    const manager = new SubagentManager({
      provider: new HighRiskOnlyProvider(),
      workspace,
      bus,
      model: "high-risk-only",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    await manager.spawnTask({
      task: "run timeout",
      originChannel: "workflow",
      originChatId: "run_b:node_b",
      sessionKey: "workflow:run_b:node_b:1",
      announceToMainAgent: false,
      workflowContext: {
        runId: "run_b",
        nodeId: "node_b",
        nodeName: "node_b",
        hitl: {
          enabled: true,
          highRiskTools: ["exec"],
          approvalTarget: "owner",
          approvalTimeoutMs: 30,
        },
      },
    });

    await waitFor(() => expired.length === 1, 2000);
    await waitFor(() => failed.length === 1, 2000);
  });

  it("cancels pending approvals by session and cleans up waiters", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const requested: string[] = [];
    const cancelled: string[] = [];
    const failed: string[] = [];
    bus.onSubagentApprovalRequested((event) => {
      requested.push(event.approvalId);
    });
    bus.onSubagentApprovalCancelled((event) => {
      cancelled.push(event.approvalId);
    });
    bus.onSubagentEvent((event) => {
      if (event.type === "SUBAGENT_TASK_FAILED") {
        failed.push(event.taskId);
      }
    });

    const manager = new SubagentManager({
      provider: new HighRiskOnlyProvider(),
      workspace,
      bus,
      model: "high-risk-only",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config: makeConfig(),
    });

    await manager.spawnTask({
      task: "run cancel",
      originChannel: "workflow",
      originChatId: "run_c:node_c",
      sessionKey: "workflow:run_c:node_c:1",
      announceToMainAgent: false,
      workflowContext: {
        runId: "run_c",
        nodeId: "node_c",
        nodeName: "node_c",
        hitl: {
          enabled: true,
          highRiskTools: ["exec"],
          approvalTarget: "owner",
          approvalTimeoutMs: 5_000,
        },
      },
    });

    await waitFor(() => requested.length === 1, 2000);
    const cancelledCount = manager.cancelPendingApprovalsBySession(
      "workflow:run_c:node_c:1",
      "manual cancellation",
    );
    expect(cancelledCount).toBe(1);

    await waitFor(() => cancelled.length === 1, 2000);
    await waitFor(() => failed.length === 1, 2000);
  });

  it("supports external MCP-style tools in role allowlist", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const externalTools = new ToolRegistry();
    externalTools.register(new FakeExternalMcpTool());
    const config = makeConfig();
    config.roles.researcher.allowedTools = ["lark-mcp__wiki_query"];

    const manager = new SubagentManager({
      provider: new ExternalMcpProvider(),
      workspace,
      bus,
      model: "external-mcp",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
      config,
      externalToolRegistry: externalTools,
    });

    await manager.spawn({
      task: "query with mcp",
      role: "researcher",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });

    const inbound = await bus.consumeInbound(1000);
    expect(inbound?.content).toContain("{\"ok\":true}");
  });
});
