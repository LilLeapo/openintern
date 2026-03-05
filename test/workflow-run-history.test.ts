import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { WorkflowRunSnapshot } from "../src/workflow/engine.js";
import { WorkflowRunHistoryRepository } from "../src/workflow/run-history.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-run-history-test-"));
  tempDirs.push(dir);
  return dir;
}

function snapshot(runId: string, startedAt: string): WorkflowRunSnapshot {
  return {
    runId,
    workflowId: "wf_demo",
    status: "running",
    startedAt,
    endedAt: null,
    error: null,
    execution: {
      mode: "serial",
      maxParallel: 1,
    },
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

describe("WorkflowRunHistoryRepository", () => {
  it("saves and loads run snapshots", async () => {
    const workspace = await makeWorkspace();
    const repo = new WorkflowRunHistoryRepository(workspace);
    const run = snapshot("run_1", "2026-03-05T10:00:00.000Z");

    await repo.save(run);
    const loaded = await repo.load("run_1");

    expect(loaded).not.toBeNull();
    expect(loaded?.runId).toBe("run_1");
    expect(loaded?.workflowId).toBe("wf_demo");
  });

  it("lists run snapshots ordered by startedAt desc", async () => {
    const workspace = await makeWorkspace();
    const repo = new WorkflowRunHistoryRepository(workspace);
    await repo.save(snapshot("run_1", "2026-03-05T10:00:00.000Z"));
    await repo.save(snapshot("run_2", "2026-03-05T10:10:00.000Z"));

    const rows = await repo.list();
    expect(rows.map((row) => row.runId)).toEqual(["run_2", "run_1"]);
  });
});
