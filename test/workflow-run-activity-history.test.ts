import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  WorkflowRunActivityHistoryRepository,
  type WorkflowRunActivityRecord,
} from "../src/workflow/run-activity-history.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-run-activity-history-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeActivity(input: {
  id: string;
  runId: string;
  timestamp: string;
  type: "subagent.task.completed" | "subagent.task.failed";
}): WorkflowRunActivityRecord {
  return {
    id: input.id,
    runId: input.runId,
    nodeId: "node_1",
    taskId: `task_${input.id}`,
    role: "scientist",
    label: "node_1",
    task: "do work",
    status: input.type === "subagent.task.failed" ? "error" : "ok",
    result: input.type === "subagent.task.failed" ? "failed" : "ok",
    type: input.type,
    timestamp: input.timestamp,
    messages: [],
    toolCalls: [],
  };
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

describe("WorkflowRunActivityHistoryRepository", () => {
  it("appends and lists persisted activities", async () => {
    const workspace = await makeWorkspace();
    const repo = new WorkflowRunActivityHistoryRepository(workspace);
    await repo.append(
      "run_1",
      makeActivity({
        id: "a1",
        runId: "run_1",
        timestamp: "2026-03-05T10:00:00.000Z",
        type: "subagent.task.completed",
      }),
    );
    await repo.append(
      "run_1",
      makeActivity({
        id: "a2",
        runId: "run_1",
        timestamp: "2026-03-05T10:01:00.000Z",
        type: "subagent.task.failed",
      }),
    );

    const rows = await repo.list("run_1");
    expect(rows.map((row) => row.id)).toEqual(["a2", "a1"]);
    expect(rows[0]?.type).toBe("subagent.task.failed");
  });
});
