import { Tool } from "../core/tool.js";
import type { SubagentManager } from "../../agent/subagent/manager.js";

export class SpawnTool extends Tool {
  readonly name = "spawn";
  readonly description =
    "Spawn a subagent to handle a task in the background and report back on completion.";
  readonly parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the subagent to complete",
      },
      role: {
        type: "string",
        description: "Optional role for the subagent (e.g. 'researcher', 'scientist')",
      },
      label: {
        type: "string",
        description: "Optional short label for the task",
      },
    },
    required: ["task"],
  } as const;

  private originChannel = "cli";
  private originChatId = "direct";
  private sessionKey = "cli:direct";
  private originMessageId?: string;
  private originSenderId = "user";
  private originMetadata: Record<string, unknown> | undefined;

  constructor(private readonly manager: SubagentManager) {
    super();
  }

  setContext(
    channel: string,
    chatId: string,
    messageId?: string,
    senderId = "user",
    metadata?: Record<string, unknown>,
  ): void {
    this.originChannel = channel;
    this.originChatId = chatId;
    this.sessionKey = `${channel}:${chatId}`;
    this.originMessageId = messageId;
    this.originSenderId = senderId;
    this.originMetadata = metadata;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const task = String(params.task ?? "");
    const role =
      params.role === undefined || params.role === null
        ? null
        : String(params.role);
    const label =
      params.label === undefined || params.label === null
        ? null
        : String(params.label);
    return this.manager.spawn({
      task,
      role,
      label,
      originChannel: this.originChannel,
      originChatId: this.originChatId,
      sessionKey: this.sessionKey,
      originMessageId: this.originMessageId,
      originSenderId: this.originSenderId,
      originMetadata: this.originMetadata,
    });
  }
}
