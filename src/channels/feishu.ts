import { randomUUID } from "node:crypto";

import * as Lark from "@larksuiteoapi/node-sdk";

import type { OutboundMessage } from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import type { FeishuChannelConfig } from "../config/schema.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;

interface FeishuGatewayOptions {
  config: FeishuChannelConfig;
  bus: MessageBus;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface FeishuMessageEvent {
  sender?: {
    sender_type?: string;
    sender_id?: {
      open_id?: string;
    };
  };
  message?: {
    message_id?: string;
    chat_id?: string;
    chat_type?: string;
    message_type?: string;
    content?: string;
  };
  event?: {
    sender?: {
      sender_type?: string;
      sender_id?: {
        open_id?: string;
      };
    };
    message?: {
      message_id?: string;
      chat_id?: string;
      chat_type?: string;
      message_type?: string;
      content?: string;
    };
  };
}

export class FeishuChannel {
  private readonly config: FeishuChannelConfig;
  private readonly bus: MessageBus;

  private wsClient: Lark.WSClient | null = null;
  private cachedToken: CachedToken | null = null;
  private readonly processedMessageIds = new Map<string, number>();

  constructor(options: FeishuGatewayOptions) {
    this.config = options.config;
    this.bus = options.bus;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.wsClient) {
      return;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu channel enabled but appId/appSecret is missing");
    }

    const eventDispatcher = new Lark.EventDispatcher({
      verificationToken: this.config.verificationToken.trim() || undefined,
      encryptKey: this.config.encryptKey.trim() || undefined,
      loggerLevel: Lark.LoggerLevel.error,
    }).register({
      "im.message.receive_v1": async (payload: unknown) => {
        await this.handleMessageEvent(this.asObject(payload) as FeishuMessageEvent);
      },
    });

    this.wsClient = new Lark.WSClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      autoReconnect: true,
      loggerLevel: Lark.LoggerLevel.error,
    });
    await this.wsClient.start({
      eventDispatcher,
    });
  }

  async stop(): Promise<void> {
    if (!this.wsClient) {
      return;
    }
    this.wsClient.close({ force: true });
    this.wsClient = null;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.config.enabled || !message.content.trim()) {
      return;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu channel enabled but appId/appSecret is missing");
    }

    const receiveIdType = this.receiveIdTypeForChat(message.chatId);
    const payload = {
      receive_id: message.chatId,
      msg_type: "text",
      content: JSON.stringify({ text: message.content }),
      uuid: randomUUID(),
    };
    const url =
      `https://open.feishu.cn/open-apis/im/v1/messages?` +
      `receive_id_type=${encodeURIComponent(receiveIdType)}`;

    await this.withAuthRetry(async (token) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const raw = (await response.json()) as unknown;
      const body = this.asObject(raw);
      const code = typeof body.code === "number" ? body.code : -1;
      if (!response.ok || code !== 0) {
        const msg = typeof body.msg === "string" ? body.msg : response.statusText;
        throw new Error(`Feishu send failed (code=${code}, status=${response.status}): ${msg}`);
      }
    });
  }

  private async handleMessageEvent(payload: FeishuMessageEvent): Promise<void> {
    const event = payload.message || payload.sender
      ? payload
      : (this.asObject(payload.event) as FeishuMessageEvent);
    const message = event?.message;
    const sender = event?.sender;
    const senderOpenId = sender?.sender_id?.open_id ?? "";
    if (!senderOpenId) {
      return;
    }
    if (sender?.sender_type === "bot") {
      return;
    }
    if (!this.isAllowed(senderOpenId)) {
      return;
    }

    const messageId = message?.message_id ?? "";
    if (!messageId || this.isDuplicateMessage(messageId)) {
      return;
    }

    const msgType = message?.message_type ?? "unknown";
    const parsed = this.parseIncomingContent(msgType, message?.content ?? "");
    if (!parsed.content.trim()) {
      return;
    }

    const chatType = message?.chat_type ?? "";
    const chatId = chatType === "p2p" ? senderOpenId : (message?.chat_id ?? senderOpenId);
    await this.bus.publishInbound({
      channel: "feishu",
      senderId: senderOpenId,
      chatId,
      content: parsed.content,
      media: parsed.media,
      metadata: {
        message_id: messageId,
        chat_type: chatType,
        msg_type: msgType,
        source_chat_id: message?.chat_id ?? "",
      },
    });
  }

  private isAllowed(senderOpenId: string): boolean {
    const allowFrom = this.config.allowFrom;
    if (allowFrom.includes("*")) {
      return true;
    }
    return allowFrom.includes(senderOpenId);
  }

  private isDuplicateMessage(messageId: string): boolean {
    if (this.processedMessageIds.has(messageId)) {
      return true;
    }
    this.processedMessageIds.set(messageId, Date.now());
    while (this.processedMessageIds.size > 1000) {
      const first = this.processedMessageIds.keys().next();
      if (first.done) {
        break;
      }
      this.processedMessageIds.delete(first.value);
    }
    return false;
  }

  private parseIncomingContent(
    msgType: string,
    rawContent: string,
  ): { content: string; media: string[] } {
    let contentJson: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(rawContent) as unknown;
      contentJson = this.asObject(parsed);
    } catch {
      // Keep empty; fallback below.
    }

    if (msgType === "text") {
      const text = typeof contentJson.text === "string" ? contentJson.text : "";
      return { content: text, media: [] };
    }
    if (msgType === "post") {
      const text = this.extractPostText(contentJson);
      return { content: text || "[post]", media: [] };
    }
    return { content: `[${msgType}]`, media: [] };
  }

  private extractPostText(contentJson: Record<string, unknown>): string {
    const stack: unknown[] = [contentJson];
    const parts: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop();
      if (typeof current === "string") {
        if (current.trim()) {
          parts.push(current);
        }
        continue;
      }
      if (Array.isArray(current)) {
        for (const item of current) {
          stack.push(item);
        }
        continue;
      }
      if (typeof current === "object" && current !== null) {
        const obj = current as Record<string, unknown>;
        if (typeof obj.text === "string" && obj.text.trim()) {
          parts.push(obj.text);
        }
        if (typeof obj.title === "string" && obj.title.trim()) {
          parts.push(obj.title);
        }
        for (const value of Object.values(obj)) {
          stack.push(value);
        }
      }
    }
    return parts.join(" ").trim();
  }

  private async withAuthRetry(
    task: (token: string) => Promise<void>,
  ): Promise<void> {
    try {
      const token = await this.getTenantAccessToken();
      await task(token);
    } catch (error) {
      this.cachedToken = null;
      const token = await this.getTenantAccessToken();
      await task(token);
      if (error instanceof Error) {
        // If retry succeeded, ignore first error.
      }
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.value;
    }

    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret,
        }),
      },
    );

    const raw = (await response.json()) as unknown;
    const body = this.asObject(raw);
    const code = typeof body.code === "number" ? body.code : -1;
    if (!response.ok || code !== 0) {
      const msg = typeof body.msg === "string" ? body.msg : response.statusText;
      throw new Error(`Feishu token request failed (code=${code}, status=${response.status}): ${msg}`);
    }

    const token = typeof body.tenant_access_token === "string" ? body.tenant_access_token : "";
    const expireSeconds = typeof body.expire === "number" ? body.expire : 0;
    if (!token || expireSeconds <= 0) {
      throw new Error("Feishu token response missing tenant_access_token/expire");
    }

    this.cachedToken = {
      value: token,
      expiresAt: Date.now() + expireSeconds * 1000 - TOKEN_REFRESH_SKEW_MS,
    };
    return token;
  }

  private receiveIdTypeForChat(chatId: string): "chat_id" | "open_id" {
    if (chatId.startsWith("oc_")) {
      return "chat_id";
    }
    return "open_id";
  }

  private asObject(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
