export type NodeKind = "trigger" | "agent" | "action";
export type ToolRiskLevel = "low" | "high";
export type ApprovalTarget = "owner" | "group";
export type RunStatus = "idle" | "running" | "paused" | "completed";
export type TraceType = "info" | "llm" | "tool_call" | "tool_result" | "error" | "guard" | "approval";

export interface WorkflowNode {
  id: string;
  name: string;
  kind: NodeKind;
  description: string;
  role: string | null;
  requiresApproval: boolean;
  approvalTarget: ApprovalTarget;
  toolIds: string[];
  position: {
    x: number;
    y: number;
  };
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "registry";
  riskLevel: ToolRiskLevel;
  scriptName: string | null;
  scriptPreview: string | null;
  inputSchema: string;
}

export interface RoleSummary {
  id: string;
  systemPrompt: string;
  allowedTools: string[];
}

export interface ApprovalRequest {
  id: string;
  nodeId: string;
  nodeName: string;
  toolId: string;
  target: ApprovalTarget;
  status: "pending" | "approved";
  requestedAt: string;
  approvedAt: string | null;
  parameters: {
    voltageV: number;
    flowSccm: number;
  };
}

export interface TraceEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: TraceType;
  title: string;
  details: string;
  status: "ok" | "pending" | "failed";
}

export interface RunViewState {
  id: string | null;
  status: RunStatus;
  currentNodeId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pauseReason: string | null;
  pendingApprovalId: string | null;
}

export interface UiSnapshot {
  workflow: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  registry: {
    tools: ToolDefinition[];
    roles: RoleSummary[];
  };
  approvals: ApprovalRequest[];
  traces: TraceEvent[];
  run: RunViewState;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  message?: string;
  data?: T;
}

export const kindLabel: Record<NodeKind, string> = {
  trigger: "EVENT TRIGGER",
  agent: "SUB-AGENT TASK",
  action: "ACTION",
};

export const runStatusStyle: Record<RunStatus, string> = {
  idle: "bg-slate-100 text-slate-600 border-slate-300",
  running: "bg-emerald-100 text-emerald-700 border-emerald-300",
  paused: "bg-amber-100 text-amber-700 border-amber-300",
  completed: "bg-blue-100 text-blue-700 border-blue-300",
};

export const traceTypeStyle: Record<TraceType, string> = {
  info: "bg-slate-100 text-slate-700 border-slate-300",
  llm: "bg-blue-100 text-blue-700 border-blue-300",
  tool_call: "bg-emerald-100 text-emerald-700 border-emerald-300",
  tool_result: "bg-teal-100 text-teal-700 border-teal-300",
  error: "bg-red-100 text-red-700 border-red-300",
  guard: "bg-purple-100 text-purple-700 border-purple-300",
  approval: "bg-amber-100 text-amber-700 border-amber-300",
};

export const defaultSchema = `{
  "type": "object",
  "properties": {
    "csv_path": {"type": "string"}
  },
  "required": ["csv_path"]
}`;

export function formatTime(iso: string | null): string {
  if (!iso) {
    return "-";
  }
  const date = new Date(iso);
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const dd = `${date.getDate()}`.padStart(2, "0");
  const hh = `${date.getHours()}`.padStart(2, "0");
  const min = `${date.getMinutes()}`.padStart(2, "0");
  const sec = `${date.getSeconds()}`.padStart(2, "0");
  return `${mm}-${dd} ${hh}:${min}:${sec}`;
}
