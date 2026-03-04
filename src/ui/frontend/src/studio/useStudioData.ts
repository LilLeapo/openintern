import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "./api";
import type {
  ApprovalRequest,
  DataFreshness,
  EditableRoleInput,
  ExecutableWorkflowDefinition,
  RuntimeCatalog,
  RuntimeEventEnvelope,
  RuntimeRunActivity,
  RuntimeTraceEvent,
  WorkflowRunDetail,
  WorkflowDefinitionSummary,
  WorkflowRunSnapshot,
} from "./types";
import { starterWorkflow } from "./types";

function upsertByKey<T>(items: T[], incoming: T, key: (value: T) => string): T[] {
  const incomingKey = key(incoming);
  const filtered = items.filter((item) => key(item) !== incomingKey);
  return [incoming, ...filtered];
}

function mergeTraces(current: RuntimeTraceEvent[], incoming: RuntimeTraceEvent[], max = 500): RuntimeTraceEvent[] {
  const byId = new Map<string, RuntimeTraceEvent>();
  for (const item of [...incoming, ...current]) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, max);
}

function mergeActivities(
  current: RuntimeRunActivity[],
  incoming: RuntimeRunActivity[],
  max = 200,
): RuntimeRunActivity[] {
  const byId = new Map<string, RuntimeRunActivity>();
  for (const item of [...incoming, ...current]) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values())
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, max);
}

function parseWorkflowJson(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Workflow JSON must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function mapApproval(item: Record<string, unknown>): ApprovalRequest {
  const toolCalls = Array.isArray(item.toolCalls)
    ? item.toolCalls
        .map((toolCall) => {
          if (typeof toolCall !== "object" || toolCall === null) {
            return null;
          }
          const obj = toolCall as Record<string, unknown>;
          return {
            id: typeof obj.id === "string" ? obj.id : "",
            name: typeof obj.name === "string" ? obj.name : "",
            arguments:
              typeof obj.arguments === "object" && obj.arguments !== null
                ? (obj.arguments as Record<string, unknown>)
                : {},
            highRisk: obj.highRisk === true,
          };
        })
        .filter(
          (
            row,
          ): row is {
            id: string;
            name: string;
            arguments: Record<string, unknown>;
            highRisk: boolean;
          } => row !== null,
        )
    : [];

  return {
    id: typeof item.approvalId === "string" ? item.approvalId : "",
    runId: typeof item.runId === "string" ? item.runId : "",
    workflowId: typeof item.workflowId === "string" ? item.workflowId : "",
    nodeId: typeof item.nodeId === "string" ? item.nodeId : "",
    nodeName: typeof item.nodeName === "string" ? item.nodeName : "",
    toolId: toolCalls[0]?.name ?? "",
    taskId: typeof item.taskId === "string" ? item.taskId : undefined,
    commandPreview: typeof item.commandPreview === "string" ? item.commandPreview : undefined,
    toolCalls,
    target: item.approvalTarget === "group" ? "group" : "owner",
    status:
      item.status === "approved" || item.status === "expired" || item.status === "cancelled"
        ? item.status
        : "pending",
    requestedAt: typeof item.requestedAt === "string" ? item.requestedAt : new Date().toISOString(),
    expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : null,
    approvedAt: typeof item.approvedAt === "string" ? item.approvedAt : null,
    reason: typeof item.reason === "string" ? item.reason : null,
    approver: typeof item.approver === "string" ? item.approver : null,
  };
}

function mapRunActivity(raw: Record<string, unknown>): RuntimeRunActivity | null {
  const id = typeof raw.id === "string" ? raw.id : "";
  const runId = typeof raw.runId === "string" ? raw.runId : "";
  const taskId = typeof raw.taskId === "string" ? raw.taskId : "";
  if (!id || !runId || !taskId) {
    return null;
  }

  const messages: RuntimeRunActivity["messages"] = [];
  if (Array.isArray(raw.messages)) {
    for (const item of raw.messages) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      const roleRaw = typeof row.role === "string" ? row.role : "assistant";
      const role =
        roleRaw === "system" || roleRaw === "user" || roleRaw === "assistant" || roleRaw === "tool"
          ? roleRaw
          : "assistant";
      const message: RuntimeRunActivity["messages"][number] = {
        role,
        content: typeof row.content === "string" ? row.content : "",
        at: typeof row.at === "string" ? row.at : new Date().toISOString(),
      };
      if (typeof row.name === "string") {
        message.name = row.name;
      }
      if (typeof row.toolCallId === "string") {
        message.toolCallId = row.toolCallId;
      }
      messages.push(message);
    }
  }

  const toolCalls: RuntimeRunActivity["toolCalls"] = [];
  if (Array.isArray(raw.toolCalls)) {
    for (const item of raw.toolCalls) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const row = item as Record<string, unknown>;
      toolCalls.push({
        id: typeof row.id === "string" ? row.id : "",
        name: typeof row.name === "string" ? row.name : "",
        arguments:
          typeof row.arguments === "object" && row.arguments !== null
            ? (row.arguments as Record<string, unknown>)
            : {},
        result: typeof row.result === "string" ? row.result : "",
        highRisk: row.highRisk === true,
        at: typeof row.at === "string" ? row.at : new Date().toISOString(),
      });
    }
  }

  return {
    id,
    runId,
    nodeId: typeof raw.nodeId === "string" ? raw.nodeId : null,
    taskId,
    role: typeof raw.role === "string" ? raw.role : null,
    label: typeof raw.label === "string" ? raw.label : "",
    task: typeof raw.task === "string" ? raw.task : "",
    status: raw.status === "error" ? "error" : "ok",
    result: typeof raw.result === "string" ? raw.result : "",
    type: raw.type === "subagent.task.failed" ? "subagent.task.failed" : "subagent.task.completed",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString(),
    messages,
    toolCalls,
  };
}

export function useStudioData() {
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null);
  const [publishedDefs, setPublishedDefs] = useState<WorkflowDefinitionSummary[]>([]);
  const [draftDefs, setDraftDefs] = useState<WorkflowDefinitionSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRunSnapshot[]>([]);
  const [runDetails, setRunDetails] = useState<Record<string, WorkflowRunDetail>>({});
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [traces, setTraces] = useState<RuntimeTraceEvent[]>([]);
  const [freshness, setFreshness] = useState<DataFreshness>("stale");
  const [workflowJson, setWorkflowJson] = useState<string>(
    `${JSON.stringify(starterWorkflow, null, 2)}\n`,
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const retryTimerRef = useRef<number | null>(null);
  const resyncingRef = useRef(false);
  const eventBufferRef = useRef<RuntimeEventEnvelope[]>([]);
  const mountedRef = useRef(true);
  const backoffRef = useRef(1_000);

  const clearRetry = () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const loadCatalog = useCallback(async () => {
    const data = await api<RuntimeCatalog>("/api/runtime/catalog");
    if (mountedRef.current) {
      setCatalog(data);
    }
    return data;
  }, []);

  const loadWorkflowDefs = useCallback(async () => {
    const [published, drafts] = await Promise.all([
      api<{ workflows: WorkflowDefinitionSummary[] }>("/api/runtime/workflow-defs/published"),
      api<{ workflows: WorkflowDefinitionSummary[] }>("/api/runtime/workflow-defs/drafts"),
    ]);
    if (!mountedRef.current) {
      return;
    }
    setPublishedDefs(published.workflows);
    setDraftDefs(drafts.workflows);
  }, []);

  const fetchRuns = useCallback(async () => {
    const data = await api<{ runs: WorkflowRunSnapshot[] }>("/api/runtime/workflows/runs?limit=200");
    return data.runs;
  }, []);

  const fetchTraces = useCallback(async () => {
    const data = await api<{ traces: RuntimeTraceEvent[] }>("/api/runtime/traces?limit=500");
    return data.traces;
  }, []);

  const fetchApprovals = useCallback(async () => {
    const data = await api<{ approvals: Array<Record<string, unknown>> }>(
      "/api/runtime/hitl/approvals",
    );
    return data.approvals.map(mapApproval);
  }, []);

  const fetchRunDetail = useCallback(async (runId: string) => {
    const data = await api<{
      run: WorkflowRunSnapshot;
      traces: RuntimeTraceEvent[];
      activities: Array<Record<string, unknown>>;
    }>(`/api/runtime/workflows/${encodeURIComponent(runId)}?traceLimit=300&activityLimit=200`);
    return {
      run: data.run,
      traces: data.traces,
      activities: data.activities
        .map((item) => mapRunActivity(item))
        .filter((item): item is RuntimeRunActivity => item !== null),
    } satisfies WorkflowRunDetail;
  }, []);

  const applyEnvelope = useCallback(
    (envelope: RuntimeEventEnvelope) => {
      if (!mountedRef.current) {
        return;
      }

      if (envelope.type === "run.status.changed") {
        const run = envelope.data.run as WorkflowRunSnapshot | undefined;
        if (run?.runId) {
          setRuns((prev) => upsertByKey(prev, run, (item) => item.runId));
          setRunDetails((prev) => {
            const existing = prev[run.runId];
            if (!existing) {
              return prev;
            }
            return {
              ...prev,
              [run.runId]: {
                ...existing,
                run,
              },
            };
          });
        }
        return;
      }

      if (envelope.type === "approval.requested" || envelope.type === "approval.updated") {
        void fetchApprovals()
          .then((rows) => {
            if (!mountedRef.current) {
              return;
            }
            setApprovals(rows);
          })
          .catch(() => {
            // Ignore transient refresh failure; next resync will recover.
          });
        return;
      }

      if (envelope.type === "trace.append") {
        const traceRaw =
          typeof envelope.data.trace === "object" && envelope.data.trace !== null
            ? (envelope.data.trace as RuntimeTraceEvent)
            : null;
        if (traceRaw) {
          setTraces((prev) => mergeTraces(prev, [traceRaw]));
          setRunDetails((prev) => {
            const existing = prev[traceRaw.runId];
            if (!existing) {
              return prev;
            }
            return {
              ...prev,
              [traceRaw.runId]: {
                ...existing,
                traces: mergeTraces(existing.traces, [traceRaw], 300),
              },
            };
          });
        }
        return;
      }

      if (envelope.type === "run.activity.append") {
        const runId = typeof envelope.data.runId === "string" ? envelope.data.runId : "";
        const rawActivity =
          typeof envelope.data.activity === "object" && envelope.data.activity !== null
            ? (envelope.data.activity as Record<string, unknown>)
            : null;
        if (!runId || !rawActivity) {
          return;
        }
        const activity = mapRunActivity(rawActivity);
        if (!activity) {
          return;
        }
        setRunDetails((prev) => {
          const existing = prev[runId];
          if (!existing) {
            return prev;
          }
          return {
            ...prev,
            [runId]: {
              ...existing,
              activities: mergeActivities(existing.activities, [activity], 200),
            },
          };
        });
      }
    },
    [fetchApprovals],
  );

  const fullResync = useCallback(async () => {
    if (resyncingRef.current) {
      return;
    }

    resyncingRef.current = true;
    setFreshness("resyncing");

    try {
      const [nextRuns, nextTraces, nextApprovals] = await Promise.all([
        fetchRuns(),
        fetchTraces(),
        fetchApprovals(),
      ]);

      if (!mountedRef.current) {
        return;
      }

      setRuns(nextRuns);
      setTraces(nextTraces);
      setApprovals(nextApprovals);
      setRunDetails((prev) => {
        const next: Record<string, WorkflowRunDetail> = {};
        for (const run of nextRuns) {
          const existing = prev[run.runId];
          if (!existing) {
            continue;
          }
          next[run.runId] = {
            ...existing,
            run,
            traces: nextTraces.filter((trace) => trace.runId === run.runId).slice(0, 300),
          };
        }
        return next;
      });

      const buffered = [...eventBufferRef.current];
      eventBufferRef.current = [];
      for (const envelope of buffered) {
        applyEnvelope(envelope);
      }

      setFreshness("live");
      backoffRef.current = 1_000;
      clearRetry();
    } catch {
      if (!mountedRef.current) {
        return;
      }
      setFreshness("stale");
      clearRetry();
      const waitMs = backoffRef.current;
      backoffRef.current = Math.min(30_000, backoffRef.current * 2);
      retryTimerRef.current = window.setTimeout(() => {
        void fullResync();
      }, waitMs);
    } finally {
      resyncingRef.current = false;
    }
  }, [applyEnvelope, fetchApprovals, fetchRuns, fetchTraces]);

  const handleEnvelope = useCallback(
    (envelope: RuntimeEventEnvelope) => {
      if (resyncingRef.current) {
        eventBufferRef.current.push(envelope);
        return;
      }
      applyEnvelope(envelope);
    },
    [applyEnvelope],
  );

  const refreshAll = useCallback(async () => {
    await Promise.all([loadCatalog(), loadWorkflowDefs(), fullResync()]);
  }, [fullResync, loadCatalog, loadWorkflowDefs]);

  useEffect(() => {
    mountedRef.current = true;
    void refreshAll();

    const source = new EventSource("/api/runtime/events/stream");

    const handleNamedEvent = (event: Event) => {
      const payload = event as MessageEvent<string>;
      try {
        const envelope = JSON.parse(payload.data) as RuntimeEventEnvelope;
        handleEnvelope(envelope);
      } catch {
        // Ignore malformed event payload.
      }
    };

    source.onopen = () => {
      void fullResync();
    };

    source.onerror = () => {
      if (mountedRef.current) {
        setFreshness("stale");
      }
    };

    const eventTypes = [
      "stream.connected",
      "run.status.changed",
      "node.status.changed",
      "approval.requested",
      "approval.updated",
      "subagent.task.completed",
      "subagent.task.failed",
      "run.activity.append",
      "trace.append",
    ];
    for (const eventType of eventTypes) {
      source.addEventListener(eventType, handleNamedEvent);
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void fullResync();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mountedRef.current = false;
      clearRetry();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const eventType of eventTypes) {
        source.removeEventListener(eventType, handleNamedEvent);
      }
      source.close();
    };
  }, [fullResync, handleEnvelope, refreshAll]);

  const loadDraftToEditor = useCallback(async (draftId: string) => {
    const data = await api<{
      draftId: string;
      definition: unknown;
      normalized: unknown | null;
      valid: boolean;
      error: string | null;
      path: string;
      reviewUrl: string;
    }>(`/api/runtime/workflow-defs/drafts/${encodeURIComponent(draftId)}`);

    setWorkflowJson(`${JSON.stringify(data.definition, null, 2)}\n`);
    setSelectedDraftId(draftId);
    return data;
  }, []);

  const loadPublishedToEditor = useCallback(async (workflowId: string) => {
    const data = await api<{
      id: string;
      source: "published";
      definition: unknown;
      normalized: unknown | null;
      valid: boolean;
      error: string | null;
      path: string;
    }>(`/api/runtime/workflow-defs/published/${encodeURIComponent(workflowId)}`);
    setWorkflowJson(`${JSON.stringify(data.definition, null, 2)}\n`);
    setSelectedDraftId(null);
    return data;
  }, []);

  const saveDraft = useCallback(
    async (draftId?: string | null) => {
      const definition = parseWorkflowJson(workflowJson);

      if (draftId) {
        const data = await api<{
          draftId: string;
        }>(`/api/runtime/workflow-defs/drafts/${encodeURIComponent(draftId)}`, {
          method: "PUT",
          body: JSON.stringify({ definition }),
        });
        setSelectedDraftId(data.draftId);
      } else {
        const data = await api<{
          draftId: string;
        }>("/api/runtime/workflow-defs/drafts", {
          method: "POST",
          body: JSON.stringify({ definition }),
        });
        setSelectedDraftId(data.draftId);
      }

      await loadWorkflowDefs();
    },
    [loadWorkflowDefs, workflowJson],
  );

  const publishDraft = useCallback(
    async (draftId: string, workflowId?: string) => {
      await api<{ workflowId: string }>("/api/runtime/workflow-defs/publish", {
        method: "POST",
        body: JSON.stringify({
          draftId,
          workflowId,
          overwrite: true,
        }),
      });
      await loadWorkflowDefs();
    },
    [loadWorkflowDefs],
  );

  const startRunFromEditor = useCallback(async () => {
    const definition = parseWorkflowJson(workflowJson);
    const data = await api<{ runId: string; run: WorkflowRunSnapshot }>("/api/runtime/workflows/start", {
      method: "POST",
      body: JSON.stringify({
        definition,
      }),
    });
    setRuns((prev) => upsertByKey(prev, data.run, (item) => item.runId));
    await fullResync();
    return data;
  }, [fullResync, workflowJson]);

  const startRunFromDraft = useCallback(
    async (draftId: string) => {
      const data = await api<{ runId: string; run: WorkflowRunSnapshot }>("/api/runtime/workflows/start", {
        method: "POST",
        body: JSON.stringify({
          workflowRef: {
            source: "draft",
            id: draftId,
          },
        }),
      });
      setRuns((prev) => upsertByKey(prev, data.run, (item) => item.runId));
      await fullResync();
      return data;
    },
    [fullResync],
  );

  const startRunFromPublished = useCallback(
    async (workflowId: string) => {
      const data = await api<{ runId: string; run: WorkflowRunSnapshot }>("/api/runtime/workflows/start", {
        method: "POST",
        body: JSON.stringify({
          workflowRef: {
            source: "published",
            id: workflowId,
          },
        }),
      });
      setRuns((prev) => upsertByKey(prev, data.run, (item) => item.runId));
      await fullResync();
      return data;
    },
    [fullResync],
  );

  const cancelRun = useCallback(
    async (runId: string) => {
      await api<{ run: WorkflowRunSnapshot | null }>(
        `/api/runtime/workflows/${encodeURIComponent(runId)}/cancel`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      await fullResync();
    },
    [fullResync],
  );

  const approve = useCallback(
    async (approvalId: string) => {
      await api<{ approvals: Array<Record<string, unknown>> }>(
        `/api/runtime/hitl/approvals/${encodeURIComponent(approvalId)}/approve`,
        {
          method: "POST",
          body: JSON.stringify({ approver: "researcher" }),
        },
      );
      await fullResync();
    },
    [fullResync],
  );

  const createTestApproval = useCallback(
    async (input?: {
      runId?: string;
      workflowId?: string;
      nodeId?: string;
      nodeName?: string;
      commandPreview?: string;
    }) => {
      await api<{ approvals: Array<Record<string, unknown>> }>(
        "/api/runtime/hitl/approvals/test-request",
        {
          method: "POST",
          body: JSON.stringify({
            ...input,
            toolCalls: [
              {
                name: "exec",
                arguments: {
                  command: "echo approval test",
                },
                highRisk: true,
              },
            ],
          }),
        },
      );
      await fullResync();
    },
    [fullResync],
  );

  const loadRunDetail = useCallback(
    async (runId: string, options?: { force?: boolean }) => {
      if (!options?.force && runDetails[runId]) {
        return runDetails[runId];
      }
      const detail = await fetchRunDetail(runId);
      setRunDetails((prev) => ({
        ...prev,
        [runId]: detail,
      }));
      return detail;
    },
    [fetchRunDetail, runDetails],
  );

  const createRole = useCallback(
    async (input: EditableRoleInput) => {
      await api<{ id: string; role: EditableRoleInput }>("/api/runtime/roles", {
        method: "POST",
        body: JSON.stringify(input),
      });
      await refreshAll();
    },
    [refreshAll],
  );

  const optimizeWorkflow = useCallback(
    async (input: { instruction: string; definition?: ExecutableWorkflowDefinition }) => {
      const data = await api<{ definition: ExecutableWorkflowDefinition }>(
        "/api/runtime/assist/optimize-workflow",
        {
          method: "POST",
          body: JSON.stringify({
            instruction: input.instruction,
            definition: input.definition,
          }),
        },
      );
      setWorkflowJson(`${JSON.stringify(data.definition, null, 2)}\n`);
      return data.definition;
    },
    [],
  );

  const optimizeRole = useCallback(
    async (input: { instruction: string; roleId?: string; role?: Partial<EditableRoleInput> }) => {
      const data = await api<{ id: string; role: EditableRoleInput }>("/api/runtime/assist/optimize-role", {
        method: "POST",
        body: JSON.stringify({
          instruction: input.instruction,
          roleId: input.roleId,
          role: input.role,
        }),
      });
      return data;
    },
    [],
  );

  const runById = useMemo(() => new Map(runs.map((run) => [run.runId, run])), [runs]);

  return {
    catalog,
    roles: catalog?.roles ?? [],
    tools: catalog?.tools ?? [],
    skills: catalog?.skills ?? [],
    runtimeAvailable: catalog?.runtimeAvailable ?? false,
    runtimeInitError: catalog?.runtimeInitError ?? null,
    publishedDefs,
    draftDefs,
    runs,
    runById,
    runDetails,
    approvals,
    traces,
    freshness,
    workflowJson,
    setWorkflowJson,
    selectedDraftId,
    setSelectedDraftId,
    refreshAll,
    fullResync,
    loadDraftToEditor,
    loadPublishedToEditor,
    saveDraft,
    publishDraft,
    startRunFromEditor,
    startRunFromDraft,
    startRunFromPublished,
    cancelRun,
    approve,
    createTestApproval,
    loadRunDetail,
    createRole,
    optimizeWorkflow,
    optimizeRole,
  };
}

export type StudioData = ReturnType<typeof useStudioData>;
