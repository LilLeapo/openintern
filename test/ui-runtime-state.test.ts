import { describe, expect, it } from "vitest";

import type { SpawnTaskOptions, SpawnTaskResult } from "../src/agent/subagent/manager.js";
import { MessageBus } from "../src/bus/message-bus.js";
import type { SubagentTaskEvent } from "../src/bus/events.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { UiRuntimeState } from "../src/ui/runtime-state.js";
import { WorkflowEngine } from "../src/workflow/engine.js";

class FakeSubagentManager {
  private seq = 0;

  async spawnTask(_options: SpawnTaskOptions): Promise<SpawnTaskResult> {
    this.seq += 1;
    return {
      taskId: `task_${this.seq}`,
      label: `task_${this.seq}`,
      queued: false,
      queuePosition: null,
      ack: "started",
    };
  }
}

async function waitFor(check: () => boolean, timeoutMs = 1500, intervalMs = 20): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timeout");
}

function completedEvent(input: {
  taskId: string;
  runId: string;
  nodeId: string;
  result: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result: string;
    highRisk: boolean;
    at: string;
  }>;
  messages?: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    at: string;
  }>;
}): SubagentTaskEvent {
  return {
    type: "SUBAGENT_TASK_COMPLETED",
    taskId: input.taskId,
    role: "scientist",
    label: input.taskId,
    task: "task",
    status: "ok",
    result: input.result,
    toolCalls: input.toolCalls,
    messages: input.messages,
    originChannel: "workflow",
    originChatId: `${input.runId}:${input.nodeId}`,
    timestamp: new Date(),
  };
}

function failedEvent(input: {
  taskId: string;
  runId: string;
  nodeId: string;
  result: string;
}): SubagentTaskEvent {
  return {
    type: "SUBAGENT_TASK_FAILED",
    taskId: input.taskId,
    role: "scientist",
    label: input.taskId,
    task: "task",
    status: "error",
    result: input.result,
    originChannel: "workflow",
    originChatId: `${input.runId}:${input.nodeId}`,
    timestamp: new Date(),
  };
}

describe("UiRuntimeState", () => {
  it("tracks runs and traces from workflow execution", async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine({
      bus,
      subagents: new FakeSubagentManager(),
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });
    const runtime = new UiRuntimeState({ bus, engine });

    const started = await runtime.startWorkflow({
      definition: {
        id: "wf_runtime",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_main",
            role: "scientist",
            taskPrompt: "Do work",
            dependsOn: [],
            outputKeys: ["ok"],
          },
        ],
      },
      triggerInput: {},
      originChannel: "ui",
      originChatId: "studio",
    });

    await waitFor(() => runtime.listRuns().length > 0);
    const run = runtime.getRun(started.runId);
    expect(run?.runId).toBe(started.runId);

    await bus.emitSubagentEvent(
      completedEvent({
        taskId: "task_1",
        runId: started.runId,
        nodeId: "node_main",
        result: '{"ok":true}',
        messages: [
          {
            role: "assistant",
            content: '{"ok":true}',
            at: new Date().toISOString(),
          },
        ],
        toolCalls: [
          {
            id: "call_1",
            name: "exec",
            arguments: {
              command: "echo hi",
            },
            result: "hi",
            highRisk: true,
            at: new Date().toISOString(),
          },
        ],
      }),
    );

    await waitFor(() => runtime.getRun(started.runId)?.status === "completed");

    const traces = runtime.listTraces({ runId: started.runId });
    expect(traces.some((trace) => trace.type === "run.started")).toBe(true);
    expect(traces.some((trace) => trace.type === "subagent.task.completed")).toBe(true);
    expect(traces.some((trace) => trace.type === "run.status.changed")).toBe(true);
    const activities = runtime.listRunActivities({ runId: started.runId });
    expect(activities.length).toBe(1);
    expect(activities[0]?.toolCalls[0]?.name).toBe("exec");

    runtime.close();
    engine.close();
  });

  it("supports trace limit filtering", async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine({
      bus,
      subagents: new FakeSubagentManager(),
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });
    const runtime = new UiRuntimeState({ bus, engine });

    const started = await runtime.startWorkflow({
      definition: {
        id: "wf_runtime_limit",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_main",
            role: "scientist",
            taskPrompt: "Do work",
            dependsOn: [],
            outputKeys: ["ok"],
          },
        ],
      },
      triggerInput: {},
      originChannel: "ui",
      originChatId: "studio",
    });

    await waitFor(() => {
      const snapshot = runtime.getRun(started.runId);
      return Boolean(snapshot && snapshot.activeTaskIds.length > 0);
    });
    const activeTaskId = runtime.getRun(started.runId)?.activeTaskIds[0];
    expect(activeTaskId).toBeDefined();

    await bus.emitSubagentEvent(
      completedEvent({
        taskId: String(activeTaskId),
        runId: started.runId,
        nodeId: "node_main",
        result: '{"ok":true}',
      }),
    );

    await waitFor(() => runtime.getRun(started.runId)?.status === "completed");

    const limited = runtime.listTraces({ runId: started.runId, limit: 1 });
    expect(limited.length).toBe(1);

    runtime.close();
    engine.close();
  });

  it("records subagent failure reason in trace details", async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine({
      bus,
      subagents: new FakeSubagentManager(),
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });
    const runtime = new UiRuntimeState({ bus, engine });

    const started = await runtime.startWorkflow({
      definition: {
        id: "wf_runtime_fail_trace",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_main",
            role: "scientist",
            taskPrompt: "Do work",
            dependsOn: [],
            outputKeys: ["ok"],
          },
        ],
      },
      triggerInput: {},
      originChannel: "ui",
      originChatId: "studio",
    });

    await waitFor(() => {
      const snapshot = runtime.getRun(started.runId);
      return Boolean(snapshot && snapshot.activeTaskIds.length > 0);
    });
    const activeTaskId = runtime.getRun(started.runId)?.activeTaskIds[0];
    expect(activeTaskId).toBeDefined();

    await bus.emitSubagentEvent(
      failedEvent({
        taskId: String(activeTaskId),
        runId: started.runId,
        nodeId: "node_main",
        result: "tool exec failed: exit code 2",
      }),
    );

    await waitFor(() => runtime.getRun(started.runId)?.status === "failed");
    const traces = runtime.listTraces({ runId: started.runId });
    const failedTrace = traces.find((trace) => trace.type === "subagent.task.failed");
    expect(failedTrace?.details).toContain("error=tool exec failed: exit code 2");

    runtime.close();
    engine.close();
  });

  it("creates and approves mock approval requests for UI testing", async () => {
    const bus = new MessageBus();
    const engine = new WorkflowEngine({
      bus,
      subagents: new FakeSubagentManager(),
      workspace: process.cwd(),
      config: structuredClone(DEFAULT_CONFIG),
    });
    const runtime = new UiRuntimeState({ bus, engine });

    const approval = runtime.createMockApproval({
      runId: "run_mock_case",
      workflowId: "wf_mock_case",
      nodeId: "node_risky",
      nodeName: "Risk Node",
      toolCalls: [
        {
          name: "exec",
          arguments: {
            command: "echo mock",
          },
          highRisk: true,
        },
      ],
    });

    expect(approval.status).toBe("pending");
    expect(runtime.listApprovals({ pendingOnly: true }).some((item) => item.approvalId === approval.approvalId)).toBe(
      true,
    );

    await runtime.approve(approval.approvalId, "tester");
    const resolved = runtime.listApprovals().find((item) => item.approvalId === approval.approvalId);
    expect(resolved?.status).toBe("approved");

    runtime.close();
    engine.close();
  });
});
