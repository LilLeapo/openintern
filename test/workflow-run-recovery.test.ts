import { describe, expect, it } from "vitest";

import type { WorkflowRunSnapshot } from "../src/workflow/engine.js";
import { recoverRunSnapshot } from "../src/workflow/run-recovery.js";

function makeSnapshot(input?: Partial<WorkflowRunSnapshot>): WorkflowRunSnapshot {
  return {
    runId: "run_test_1",
    workflowId: "wf_test",
    status: "running",
    startedAt: "2026-03-05T10:00:00.000Z",
    endedAt: null,
    error: null,
    execution: {
      mode: "parallel",
      maxParallel: 2,
    },
    triggerInput: {},
    originChannel: "cli",
    originChatId: "direct",
    activeTaskIds: [],
    outputs: {},
    approvals: [],
    nodes: [
      {
        id: "node_a",
        status: "pending",
        attempt: 0,
        maxAttempts: 1,
        currentTaskId: null,
        lastError: null,
      },
      {
        id: "node_b",
        status: "pending",
        attempt: 0,
        maxAttempts: 1,
        currentTaskId: null,
        lastError: null,
      },
    ],
    ...input,
  };
}

describe("recoverRunSnapshot", () => {
  it("marks stale all-pending runs as failed", () => {
    const snapshot = makeSnapshot();
    const result = recoverRunSnapshot(snapshot, {
      now: new Date("2026-03-05T10:05:00.000Z"),
    });

    expect(result.recovered).toBe(true);
    expect(result.snapshot.status).toBe("failed");
    expect(result.snapshot.endedAt).toBe("2026-03-05T10:05:00.000Z");
    expect(result.snapshot.error).toContain("Recovered orphan run");
    expect(result.snapshot.nodes.some((node) => node.status === "failed")).toBe(true);
  });

  it("marks stale running-without-task runs as failed", () => {
    const snapshot = makeSnapshot({
      nodes: [
        {
          id: "node_a",
          status: "running",
          attempt: 1,
          maxAttempts: 1,
          currentTaskId: null,
          lastError: null,
        },
      ],
    });
    const result = recoverRunSnapshot(snapshot, {
      now: new Date("2026-03-05T10:08:00.000Z"),
    });

    expect(result.recovered).toBe(true);
    expect(result.snapshot.status).toBe("failed");
    expect(result.snapshot.nodes[0]?.status).toBe("failed");
  });

  it("keeps fresh running snapshot untouched", () => {
    const snapshot = makeSnapshot();
    const result = recoverRunSnapshot(snapshot, {
      now: new Date("2026-03-05T10:00:30.000Z"),
    });
    expect(result.recovered).toBe(false);
    expect(result.snapshot).toBe(snapshot);
  });
});
