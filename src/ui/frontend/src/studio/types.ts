export type ToolRiskLevel = "low" | "high";
export type ApprovalTarget = "owner" | "group";

export type RunStatus =
  | "idle"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "mcp";
  riskLevel: ToolRiskLevel;
}

export interface RoleSummary {
  id: string;
  systemPrompt: string;
  allowedTools: string[];
  memoryScope: "chat" | "papers";
  maxIterations: number;
  workspaceIsolation: boolean;
}

export interface SkillSummary {
  name: string;
  path: string;
  source: "workspace" | "builtin";
  available: boolean;
  description: string;
  requires: string[];
}

export interface RuntimeCatalog {
  runtimeAvailable: boolean;
  runtimeInitError: string | null;
  roles: RoleSummary[];
  tools: ToolDefinition[];
  skills: SkillSummary[];
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  workflowId: string;
  nodeId: string;
  nodeName: string;
  toolId: string;
  taskId?: string;
  commandPreview?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    highRisk: boolean;
  }>;
  target: ApprovalTarget;
  status: "pending" | "approved" | "expired" | "cancelled";
  requestedAt: string;
  expiresAt?: string | null;
  approvedAt: string | null;
  reason?: string | null;
  approver?: string | null;
}

export interface WorkflowRunNodeState {
  id: string;
  name?: string;
  status: "pending" | "running" | "waiting_for_approval" | "completed" | "failed";
  attempt: number;
  maxAttempts: number;
  currentTaskId: string | null;
  lastError: string | null;
}

export interface WorkflowRunSnapshot {
  runId: string;
  workflowId: string;
  status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  execution: {
    mode: "serial" | "parallel";
    maxParallel: number;
  };
  triggerInput: Record<string, unknown>;
  originChannel: string;
  originChatId: string;
  activeTaskIds: string[];
  outputs: Record<string, Record<string, unknown>>;
  approvals: Array<{
    approvalId: string;
    taskId: string;
    nodeId: string;
    nodeName: string;
    status: "pending" | "approved" | "expired" | "cancelled";
    approvalTarget: "owner" | "group";
    requestedAt: string;
    expiresAt: string;
    approvedAt: string | null;
    approver: string | null;
    commandPreview: string;
    toolCalls: Array<{
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      highRisk: boolean;
    }>;
    reason: string | null;
  }>;
  nodes: WorkflowRunNodeState[];
}

export interface RuntimeRunActivity {
  id: string;
  runId: string;
  nodeId: string | null;
  taskId: string;
  role: string | null;
  label: string;
  task: string;
  status: "ok" | "error";
  result: string;
  type: "subagent.task.completed" | "subagent.task.failed";
  timestamp: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    toolCallId?: string;
    at: string;
  }>;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result: string;
    highRisk: boolean;
    at: string;
  }>;
}

export interface WorkflowRunDetail {
  run: WorkflowRunSnapshot;
  traces: RuntimeTraceEvent[];
  activities: RuntimeRunActivity[];
}

export interface EditableRoleInput {
  id: string;
  systemPrompt: string;
  allowedTools: string[];
  memoryScope: "chat" | "papers";
  maxIterations: number;
  workspaceIsolation: boolean;
}

export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  source: "published" | "draft";
  path: string;
  updatedAt: string;
  valid: boolean;
  error: string | null;
}

export interface WorkflowDefinitionDetail {
  draftId?: string;
  id?: string;
  source?: "published" | "draft";
  definition: unknown;
  normalized: unknown | null;
  valid: boolean;
  error: string | null;
  path: string;
  reviewUrl?: string;
}

export interface RuntimeTraceEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: string;
  title: string;
  details: string;
  status: "ok" | "pending" | "failed";
  meta?: Record<string, unknown>;
}

export interface RuntimeEventEnvelope {
  eventId: string;
  seq: number;
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ExecutableWorkflowNode {
  id: string;
  name?: string;
  role: string;
  taskPrompt: string;
  dependsOn: string[];
  skillNames?: string[];
  outputKeys?: string[];
  retry?: {
    maxAttempts: number;
    backoffMs?: number;
  };
  hitl?: {
    enabled: boolean;
    highRiskTools: string[];
    approvalTarget?: "owner" | "group";
    approvalTimeoutMs?: number;
  };
}

export interface ExecutableWorkflowDefinition {
  id: string;
  name?: string;
  trigger: {
    type: "manual";
  };
  execution?: {
    mode?: "serial" | "parallel";
    maxParallel?: number;
  };
  nodes: ExecutableWorkflowNode[];
}

export type DataFreshness = "live" | "resyncing" | "stale";

export const runStatusStyle: Record<RunStatus, string> = {
  idle: "bg-slate-100 text-slate-600 border-slate-300",
  running: "bg-emerald-100 text-emerald-700 border-emerald-300",
  waiting_for_approval: "bg-orange-100 text-orange-700 border-orange-300",
  completed: "bg-blue-100 text-blue-700 border-blue-300",
  failed: "bg-red-100 text-red-700 border-red-300",
  cancelled: "bg-slate-100 text-slate-600 border-slate-300",
};

export const traceTypeStyle: Record<string, string> = {
  "run.status.changed": "bg-blue-100 text-blue-700 border-blue-300",
  "node.status.changed": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "approval.requested": "bg-amber-100 text-amber-700 border-amber-300",
  "approval.granted": "bg-emerald-100 text-emerald-700 border-emerald-300",
  "approval.expired": "bg-red-100 text-red-700 border-red-300",
  "approval.cancelled": "bg-red-100 text-red-700 border-red-300",
  "subagent.task.completed": "bg-teal-100 text-teal-700 border-teal-300",
  "subagent.task.failed": "bg-red-100 text-red-700 border-red-300",
  "trace.append": "bg-slate-100 text-slate-700 border-slate-300",
};

export const freshnessStyle: Record<DataFreshness, string> = {
  live: "bg-emerald-100 text-emerald-700 border-emerald-300",
  resyncing: "bg-amber-100 text-amber-700 border-amber-300",
  stale: "bg-red-100 text-red-700 border-red-300",
};

export interface ApiEnvelope<T> {
  ok: boolean;
  message?: string;
  data?: T;
}

export const starterWorkflow: ExecutableWorkflowDefinition = {
  id: "wf_example",
  name: "Runtime workflow",
  trigger: {
    type: "manual",
  },
  nodes: [
    {
      id: "node_main",
      name: "Main task",
      role: "scientist",
      taskPrompt: "Process {{trigger.input}} and return JSON with key 'result'.",
      dependsOn: [],
      outputKeys: ["result"],
      hitl: {
        enabled: false,
        highRiskTools: [],
      },
    },
  ],
};

export function formatTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  const sec = `${date.getSeconds()}`.padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}:${sec}`;
}
