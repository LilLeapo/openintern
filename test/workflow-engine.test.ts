import { describe, expect, it } from "vitest";

import type { SpawnTaskOptions, SpawnTaskResult } from "../src/agent/subagent/manager.js";
import { MessageBus } from "../src/bus/message-bus.js";
import type { SubagentTaskEvent } from "../src/bus/events.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { WorkflowEngine } from "../src/workflow/engine.js";

class FakeSubagentManager {
  calls: SpawnTaskOptions[] = [];
  private seq = 0;

  async spawnTask(options: SpawnTaskOptions): Promise<SpawnTaskResult> {
    this.calls.push({
      ...options,
      skillNames: [...(options.skillNames ?? [])],
    });
    this.seq += 1;
    const taskId = `task_${this.seq}`;
    return {
      taskId,
      label: options.label?.trim() || taskId,
      queued: false,
      queuePosition: null,
      ack: `Subagent [${taskId}] started (id: ${taskId}). I'll notify you when it completes.`,
    };
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 2000,
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

function makeEvent(input: {
  type: "SUBAGENT_TASK_COMPLETED" | "SUBAGENT_TASK_FAILED";
  taskId: string;
  role?: string | null;
  label?: string;
  task?: string;
  status: "ok" | "error";
  result: string;
  originChannel?: string;
  originChatId?: string;
}): SubagentTaskEvent {
  return {
    type: input.type,
    taskId: input.taskId,
    role: input.role ?? "scientist",
    label: input.label ?? input.taskId,
    task: input.task ?? "task",
    status: input.status,
    result: input.result,
    originChannel: input.originChannel ?? "workflow",
    originChatId: input.originChatId ?? "r:n",
    timestamp: new Date(),
  };
}

describe("WorkflowEngine", () => {
  it("runs serial workflow and interpolates upstream output", async () => {
    const bus = new MessageBus();
    const subagents = new FakeSubagentManager();
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });

    const handle = await engine.start(
      {
        id: "wf_serial",
        trigger: {
          type: "manual",
        },
        execution: {
          mode: "serial",
        },
        nodes: [
          {
            id: "node_clean",
            name: "Cleaner",
            role: "scientist",
            taskPrompt: "Clean {{trigger.csv_path}}",
            dependsOn: [],
            outputKeys: ["output_path"],
          },
          {
            id: "node_report",
            role: "scientist",
            taskPrompt: "Summarize {{node_clean.output_path}}",
            dependsOn: ["node_clean"],
            outputKeys: ["summary"],
          },
        ],
      },
      {
        triggerInput: {
          csv_path: "/tmp/raw.csv",
        },
        originChannel: "cli",
        originChatId: "direct",
      },
    );

    await waitFor(() => subagents.calls.length === 1);
    const first = subagents.calls[0];
    expect(first).toBeDefined();
    expect(first?.originChannel).toBe("workflow");
    expect(first?.originChatId).toBe(`${handle.runId}:node_clean`);
    expect(first?.announceToMainAgent).toBe(false);
    expect(first?.sessionKey).toBe(`workflow:${handle.runId}:node_clean:1`);

    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_1",
        status: "ok",
        result: "完成。输出如下：{\"output_path\":\"/tmp/clean.csv\"}",
        originChatId: `${handle.runId}:node_clean`,
      }),
    );

    await waitFor(() => subagents.calls.length === 2);
    expect(subagents.calls[1]?.task).toContain("/tmp/clean.csv");

    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_2",
        status: "ok",
        result: '{"summary":"done"}',
        originChatId: `${handle.runId}:node_report`,
      }),
    );

    const result = await handle.done;
    expect(result.status).toBe("completed");
    expect(result.outputs.node_clean).toEqual({ output_path: "/tmp/clean.csv" });
    expect(result.outputs.node_report).toEqual({ summary: "done" });

    const inbound = await bus.consumeInbound(100);
    expect(inbound).toBeNull();
    engine.close();
  });

  it("enforces maxParallel when mode is parallel", async () => {
    const bus = new MessageBus();
    const subagents = new FakeSubagentManager();
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });

    const handle = await engine.start(
      {
        id: "wf_parallel",
        trigger: {
          type: "manual",
        },
        execution: {
          mode: "parallel",
          maxParallel: 1,
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            outputKeys: ["a"],
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "B",
            dependsOn: [],
            outputKeys: ["b"],
          },
        ],
      },
      {
        triggerInput: {},
        originChannel: "cli",
        originChatId: "direct",
      },
    );

    await waitFor(() => subagents.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(subagents.calls.length).toBe(1);

    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_1",
        status: "ok",
        result: '{"a":1}',
      }),
    );

    await waitFor(() => subagents.calls.length === 2);
    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_2",
        status: "ok",
        result: '{"b":2}',
      }),
    );

    const result = await handle.done;
    expect(result.status).toBe("completed");
    engine.close();
  });

  it("retries node failures then fails fast when retries exhausted", async () => {
    const bus = new MessageBus();
    const subagents = new FakeSubagentManager();
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });

    const handle = await engine.start(
      {
        id: "wf_retry",
        trigger: {
          type: "manual",
        },
        nodes: [
          {
            id: "node_a",
            role: "scientist",
            taskPrompt: "A",
            dependsOn: [],
            outputKeys: ["a"],
            retry: {
              maxAttempts: 2,
            },
          },
          {
            id: "node_b",
            role: "scientist",
            taskPrompt: "B {{node_a.a}}",
            dependsOn: ["node_a"],
            outputKeys: ["b"],
          },
        ],
      },
      {
        triggerInput: {},
        originChannel: "cli",
        originChatId: "direct",
      },
    );

    await waitFor(() => subagents.calls.length === 1);
    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_1",
        status: "ok",
        result: "not a json object",
      }),
    );

    await waitFor(() => subagents.calls.length === 2);
    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_FAILED",
        taskId: "task_2",
        status: "error",
        result: "Error: failed on retry",
      }),
    );

    const result = await handle.done;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("node_a");
    expect(subagents.calls.length).toBe(2);

    engine.close();
  });

  it("enters waiting_for_approval and resumes after approval granted", async () => {
    const bus = new MessageBus();
    const subagents = new FakeSubagentManager();
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });

    const handle = await engine.start(
      {
        id: "wf_hitl_resume",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_gate",
            role: "scientist",
            taskPrompt: "Do gated work",
            dependsOn: [],
            outputKeys: ["ok"],
            hitl: {
              enabled: true,
              highRiskTools: ["exec"],
            },
          },
        ],
      },
      {
        triggerInput: {},
        originChannel: "cli",
        originChatId: "direct",
      },
    );

    await waitFor(() => subagents.calls.length === 1);
    await bus.emitSubagentApprovalRequested({
      type: "SUBAGENT_APPROVAL_REQUESTED",
      approvalId: "approval_1",
      taskId: "task_1",
      runId: handle.runId,
      nodeId: "node_gate",
      nodeName: "node_gate",
      approvalTarget: "owner",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      toolCalls: [
        {
          id: "tc1",
          name: "exec",
          arguments: { command: "echo hi" },
          highRisk: true,
        },
      ],
      commandPreview: "echo hi",
      originChannel: "workflow",
      originChatId: `${handle.runId}:node_gate`,
    });

    await waitFor(() => {
      const snapshot = engine.getRunSnapshot(handle.runId);
      return snapshot?.status === "waiting_for_approval";
    });

    await bus.emitSubagentApprovalGranted({
      type: "SUBAGENT_APPROVAL_GRANTED",
      approvalId: "approval_1",
      taskId: "task_1",
      approver: "reviewer",
      approvedAt: new Date(),
    });

    await waitFor(() => {
      const snapshot = engine.getRunSnapshot(handle.runId);
      return snapshot?.status === "running";
    });

    await bus.emitSubagentEvent(
      makeEvent({
        type: "SUBAGENT_TASK_COMPLETED",
        taskId: "task_1",
        status: "ok",
        result: "{\"ok\":true}",
      }),
    );

    const result = await handle.done;
    expect(result.status).toBe("completed");
    engine.close();
  });

  it("fails run when approval expires", async () => {
    const bus = new MessageBus();
    const subagents = new FakeSubagentManager();
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });

    const handle = await engine.start(
      {
        id: "wf_hitl_expired",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_gate",
            role: "scientist",
            taskPrompt: "Do gated work",
            dependsOn: [],
            outputKeys: ["ok"],
            hitl: {
              enabled: true,
              highRiskTools: ["exec"],
            },
          },
        ],
      },
      {
        triggerInput: {},
        originChannel: "cli",
        originChatId: "direct",
      },
    );

    await waitFor(() => subagents.calls.length === 1);
    await bus.emitSubagentApprovalRequested({
      type: "SUBAGENT_APPROVAL_REQUESTED",
      approvalId: "approval_2",
      taskId: "task_1",
      runId: handle.runId,
      nodeId: "node_gate",
      nodeName: "node_gate",
      approvalTarget: "owner",
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
      toolCalls: [
        {
          id: "tc1",
          name: "exec",
          arguments: { command: "echo hi" },
          highRisk: true,
        },
      ],
      commandPreview: "echo hi",
      originChannel: "workflow",
      originChatId: `${handle.runId}:node_gate`,
    });

    await waitFor(() => {
      const snapshot = engine.getRunSnapshot(handle.runId);
      return snapshot?.status === "waiting_for_approval";
    });

    await bus.emitSubagentApprovalExpired({
      type: "SUBAGENT_APPROVAL_EXPIRED",
      approvalId: "approval_2",
      taskId: "task_1",
      expiredAt: new Date(),
      reason: "approval timeout",
    });

    const result = await handle.done;
    expect(result.status).toBe("failed");
    expect(result.error).toContain("approval timeout");
    engine.close();
  });
});
