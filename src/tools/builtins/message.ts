import type { OutboundMessage } from "../../bus/events.js";
import { Tool } from "../core/tool.js";

export type MessageSender = (message: OutboundMessage) => Promise<void>;

export class MessageTool extends Tool {
  readonly name = "message";
  readonly description = "Send a message to a target channel/chat.";
  readonly parameters = {
    type: "object",
    properties: {
      content: { type: "string", description: "Message text" },
      channel: { type: "string", description: "Optional target channel" },
      chat_id: { type: "string", description: "Optional target chat ID" },
      media: {
        type: "array",
        items: { type: "string" },
        description: "Optional attachment file paths",
      },
    },
    required: ["content"],
  } as const;

  private defaultChannel = "";
  private defaultChatId = "";
  private defaultMessageId?: string;
  private sent = false;

  constructor(private sendCallback?: MessageSender) {
    super();
  }

  setContext(channel: string, chatId: string, messageId?: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
    this.defaultMessageId = messageId;
  }

  setSender(sender: MessageSender): void {
    this.sendCallback = sender;
  }

  startTurn(): void {
    this.sent = false;
  }

  get sentInTurn(): boolean {
    return this.sent;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const content = String(params.content ?? "");
    const channel = String(params.channel ?? this.defaultChannel);
    const chatId = String(params.chat_id ?? this.defaultChatId);
    const media = Array.isArray(params.media) ? params.media.map(String) : [];

    if (!channel || !chatId) {
      return "Error: No target channel/chat specified";
    }
    if (!this.sendCallback) {
      return "Error: Message sending not configured";
    }

    try {
      await this.sendCallback({
        channel,
        chatId,
        content,
        media,
        metadata: {
          message_id: this.defaultMessageId,
        },
      });
      if (channel === this.defaultChannel && chatId === this.defaultChatId) {
        this.sent = true;
      }
      return media.length > 0
        ? `Message sent to ${channel}:${chatId} with ${media.length} attachments`
        : `Message sent to ${channel}:${chatId}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error sending message: ${message}`;
    }
  }
}
