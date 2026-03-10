export interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  timestamp?: Date;
  media?: string[];
  metadata?: Record<string, unknown>;
  sessionKeyOverride?: string;
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media?: string[];
  metadata?: Record<string, unknown>;
}

export type AgentTraceSourceType = "main_agent" | "subagent" | "workflow" | "system";
export type AgentTraceEventType =
  | "run"
  | "iteration"
  | "intent"
  | "tool_call"
  | "approval"
  | "result";
export type AgentTracePhase = "start" | "update" | "end";
export type AgentTraceStatus =
  | "running"
  | "info"
  | "ok"
  | "error"
  | "requested"
  | "granted"
  | "expired"
  | "cancelled";

export interface AgentTraceEvent {
  type: "AGENT_TRACE";
  runId: string;
  spanId: string;
  parentSpanId: string | null;
  sourceType: AgentTraceSourceType;
  agentId: string;
  agentName: string;
  eventType: AgentTraceEventType;
  phase: AgentTracePhase;
  status: AgentTraceStatus;
  iteration?: number;
  content: string;
  originChannel: string;
  originChatId: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface SubagentTaskEvent {
  type: "SUBAGENT_TASK_COMPLETED" | "SUBAGENT_TASK_FAILED";
  taskId: string;
  role: string | null;
  label: string;
  task: string;
  status: "ok" | "error";
  result: string;
  messages?: SubagentTaskMessage[];
  toolCalls?: SubagentTaskToolCall[];
  filePaths?: string[];
  originChannel: string;
  originChatId: string;
  timestamp: Date;
}

export interface SubagentTaskMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  at: string;
}

export interface SubagentTaskToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result: string;
  highRisk: boolean;
  at: string;
}

export interface ApprovalToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  highRisk: boolean;
}

export interface SubagentApprovalRequestedEvent {
  type: "SUBAGENT_APPROVAL_REQUESTED";
  approvalId: string;
  taskId: string;
  runId: string;
  nodeId: string;
  nodeName: string;
  approvalTarget: "owner" | "group";
  requestedAt: Date;
  expiresAt: Date;
  toolCalls: ApprovalToolCall[];
  commandPreview: string;
  originChannel: string;
  originChatId: string;
}

export interface SubagentApprovalGrantedEvent {
  type: "SUBAGENT_APPROVAL_GRANTED";
  approvalId: string;
  taskId: string;
  approver: string;
  approvedAt: Date;
}

export interface SubagentApprovalExpiredEvent {
  type: "SUBAGENT_APPROVAL_EXPIRED";
  approvalId: string;
  taskId: string;
  expiredAt: Date;
  reason: string;
}

export interface SubagentApprovalCancelledEvent {
  type: "SUBAGENT_APPROVAL_CANCELLED";
  approvalId: string;
  taskId: string;
  cancelledAt: Date;
  reason: string;
}

export interface WorkflowRunStatusChangedEvent {
  type: "WORKFLOW_RUN_STATUS_CHANGED";
  runId: string;
  workflowId: string;
  status: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";
  previousStatus: "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled" | null;
  error: string | null;
  originChannel: string;
  originChatId: string;
  timestamp: Date;
}

export interface WorkflowNodeStatusChangedEvent {
  type: "WORKFLOW_NODE_STATUS_CHANGED";
  runId: string;
  workflowId: string;
  nodeId: string;
  nodeName: string | null;
  status: "pending" | "running" | "waiting_for_approval" | "completed" | "failed";
  previousStatus: "pending" | "running" | "waiting_for_approval" | "completed" | "failed" | null;
  attempt: number;
  maxAttempts: number;
  currentTaskId: string | null;
  lastError: string | null;
  timestamp: Date;
}

export function formatAgentTraceProgress(event: AgentTraceEvent): string {
  const agentLabel =
    event.agentName && event.agentName !== event.agentId
      ? `${event.agentName}#${event.agentId}`
      : event.agentId;
  return `[${agentLabel}][${event.eventType}] ${event.content}`;
}

export function getSessionKey(msg: InboundMessage): string {
  return msg.sessionKeyOverride ?? `${msg.channel}:${msg.chatId}`;
}
