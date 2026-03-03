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

export interface SubagentTaskEvent {
  type: "SUBAGENT_TASK_COMPLETED" | "SUBAGENT_TASK_FAILED";
  taskId: string;
  role: string | null;
  label: string;
  task: string;
  status: "ok" | "error";
  result: string;
  filePaths?: string[];
  originChannel: string;
  originChatId: string;
  timestamp: Date;
}

export function getSessionKey(msg: InboundMessage): string {
  return msg.sessionKeyOverride ?? `${msg.channel}:${msg.chatId}`;
}
