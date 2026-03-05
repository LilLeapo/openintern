import type { WorkflowRunSnapshot } from "./engine.js";

export interface RecoverRunOptions {
  now?: Date;
  pendingOnlyTimeoutMs?: number;
  runningWithoutTaskTimeoutMs?: number;
}

export interface RecoverRunResult {
  recovered: boolean;
  reason: string | null;
  snapshot: WorkflowRunSnapshot;
}

const DEFAULT_PENDING_ONLY_TIMEOUT_MS = 90_000;
const DEFAULT_RUNNING_WITHOUT_TASK_TIMEOUT_MS = 5 * 60_000;

function shorten(text: string, max = 280): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

function applyNodeRecovery(
  nodes: WorkflowRunSnapshot["nodes"],
  reason: string,
): WorkflowRunSnapshot["nodes"] {
  const recoverRunning = nodes.some(
    (node) => node.status === "running" || node.status === "waiting_for_approval",
  );
  if (recoverRunning) {
    return nodes.map((node) => {
      if (node.status === "running" || node.status === "waiting_for_approval") {
        return {
          ...node,
          status: "failed",
          currentTaskId: null,
          lastError: node.lastError ?? reason,
        };
      }
      return node;
    });
  }

  const firstPendingIndex = nodes.findIndex((node) => node.status === "pending");
  if (firstPendingIndex < 0) {
    return nodes;
  }
  return nodes.map((node, index) => {
    if (index !== firstPendingIndex) {
      return node;
    }
    return {
      ...node,
      status: "failed",
      currentTaskId: null,
      lastError: node.lastError ?? reason,
    };
  });
}

export function recoverRunSnapshot(
  input: WorkflowRunSnapshot,
  options?: RecoverRunOptions,
): RecoverRunResult {
  if (
    input.status !== "running" &&
    input.status !== "waiting_for_approval"
  ) {
    return {
      recovered: false,
      reason: null,
      snapshot: input,
    };
  }

  const now = options?.now ?? new Date();
  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    return {
      recovered: false,
      reason: null,
      snapshot: input,
    };
  }

  const elapsedMs = Math.max(0, now.getTime() - startedAtMs);
  const pendingOnlyTimeoutMs =
    options?.pendingOnlyTimeoutMs ?? DEFAULT_PENDING_ONLY_TIMEOUT_MS;
  const runningWithoutTaskTimeoutMs =
    options?.runningWithoutTaskTimeoutMs ?? DEFAULT_RUNNING_WITHOUT_TASK_TIMEOUT_MS;

  const hasActiveTask = input.activeTaskIds.length > 0;
  const hasPendingApproval = input.approvals.some(
    (approval) => approval.status === "pending",
  );
  const allNodesPending =
    input.nodes.length > 0 &&
    input.nodes.every((node) => node.status === "pending");
  const hasRunningNodes = input.nodes.some(
    (node) => node.status === "running" || node.status === "waiting_for_approval",
  );

  let reason: string | null = null;
  if (
    !hasActiveTask &&
    !hasPendingApproval &&
    allNodesPending &&
    elapsedMs >= pendingOnlyTimeoutMs
  ) {
    reason = `Recovered orphan run: no active task and all nodes pending for ${Math.round(
      elapsedMs / 1000,
    )}s.`;
  } else if (
    !hasActiveTask &&
    !hasPendingApproval &&
    hasRunningNodes &&
    elapsedMs >= runningWithoutTaskTimeoutMs
  ) {
    reason = `Recovered orphan run: running nodes have no active task for ${Math.round(
      elapsedMs / 1000,
    )}s.`;
  }

  if (!reason) {
    return {
      recovered: false,
      reason: null,
      snapshot: input,
    };
  }

  const mergedError = input.error
    ? `${shorten(input.error)} | ${reason}`
    : reason;
  const snapshot: WorkflowRunSnapshot = {
    ...input,
    status: "failed",
    endedAt: input.endedAt ?? now.toISOString(),
    error: mergedError,
    activeTaskIds: [],
    nodes: applyNodeRecovery(input.nodes, reason),
  };

  return {
    recovered: true,
    reason,
    snapshot,
  };
}
