import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowApprovalSnapshot, WorkflowRunSnapshot } from "../src/workflow/engine.js";
import type { RuntimeRunActivity, RuntimeTraceEvent } from "../src/ui/runtime-state.js";
import { RuntimeSqliteStore } from "../src/workflow/runtime-sqlite.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runtime-sqlite-test-"));
  tempDirs.push(dir);
  return dir;
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

function makeRun(runId: string): WorkflowRunSnapshot {
  return {
    runId,
    workflowId: "wf_demo",
    status: "running",
    startedAt: "2026-03-05T10:00:00.000Z",
    endedAt: null,
    error: null,
    execution: { mode: "serial", maxParallel: 1 },
    triggerInput: {},
    originChannel: "cli",
    originChatId: "direct",
    activeTaskIds: [],
    outputs: {},
    approvals: [],
    nodes: [
      {
        id: "node_1",
        status: "pending",
        attempt: 0,
        maxAttempts: 1,
        currentTaskId: null,
        lastError: null,
      },
    ],
  };
}

describe("RuntimeSqliteStore", () => {
  it("stores and reads runs/traces/activities/approvals", async () => {
    const workspace = await makeWorkspace();
    const store = new RuntimeSqliteStore(workspace);

    const run = makeRun("run_1");
    store.upsertRun(run);
    expect(store.getRun("run_1")?.runId).toBe("run_1");
    expect(store.listRuns().length).toBe(1);

    const trace: RuntimeTraceEvent = {
      id: "trace_1",
      runId: "run_1",
      timestamp: "2026-03-05T10:00:01.000Z",
      type: "run.started",
      title: "started",
      details: "ok",
      status: "ok",
    };
    store.upsertTrace(trace);
    expect(store.listTraces({ runId: "run_1" }).length).toBe(1);

    const activity: RuntimeRunActivity = {
      id: "activity_1",
      runId: "run_1",
      nodeId: "node_1",
      taskId: "task_1",
      role: "scientist",
      label: "node_1",
      task: "work",
      status: "ok",
      result: "done",
      type: "subagent.task.completed",
      timestamp: "2026-03-05T10:00:02.000Z",
      messages: [],
      toolCalls: [],
    };
    store.upsertActivity(activity);
    expect(store.listActivities({ runId: "run_1" }).length).toBe(1);

    const approval: WorkflowApprovalSnapshot = {
      runId: "run_1",
      workflowId: "wf_demo",
      approvalId: "ap_1",
      taskId: "task_1",
      nodeId: "node_1",
      nodeName: "node_1",
      status: "pending",
      approvalTarget: "owner",
      requestedAt: "2026-03-05T10:00:03.000Z",
      expiresAt: "2026-03-05T12:00:03.000Z",
      approvedAt: null,
      approver: null,
      commandPreview: "echo",
      toolCalls: [],
      reason: null,
    };
    store.upsertApproval(approval);
    expect(store.listApprovals({ pendingOnly: true }).length).toBe(1);

    store.close();
  });
});
