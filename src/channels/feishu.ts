import { createDecipheriv, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { OutboundMessage } from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import type { FeishuChannelConfig } from "../config/schema.js";

const MAX_BODY_BYTES = 512_000;
const TOKEN_REFRESH_SKEW_MS = 60_000;
const EVENT_OK = JSON.stringify({ code: 0, msg: "ok" });

interface FeishuGatewayOptions {
  config: FeishuChannelConfig;
  bus: MessageBus;
  host: string;
  port: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

interface FeishuEventEnvelope {
  type?: string;
  token?: string;
  challenge?: string;
  encrypt?: string;
  header?: {
    event_type?: string;
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
  private readonly host: string;
  private readonly port: number;

  private server: Server | null = null;
  private cachedToken: CachedToken | null = null;
  private readonly processedMessageIds = new Map<string, number>();

  constructor(options: FeishuGatewayOptions) {
    this.config = options.config;
    this.bus = options.bus;
    this.host = options.host;
    this.port = options.port;
  }

  get isEnabled(): boolean {
    return this.config.enabled;
  }

  get webhookPath(): string {
    const raw = this.config.webhookPath.trim() || "/feishu/events";
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (this.server) {
      return;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu channel enabled but appId/appSecret is missing");
    }

    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };

      this.server?.once("error", onError);
      this.server?.once("listening", onListening);
      this.server?.listen(this.port, this.host);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
      this.writeJson(res, 405, { code: 405, msg: "method not allowed" });
      return;
    }
    if (this.normalizePath(req.url ?? "") !== this.webhookPath) {
      this.writeJson(res, 404, { code: 404, msg: "not found" });
      return;
    }

    try {
      const body = await this.readJsonBody(req);
      const envelope = this.asObject(body) as FeishuEventEnvelope;
      const decoded = this.decodeEnvelope(envelope);
      if (decoded.type === "url_verification") {
        if (!this.verifyToken(decoded.token)) {
          this.writeJson(res, 403, { code: 403, msg: "invalid verification token" });
          return;
        }
        this.writeJson(res, 200, { challenge: decoded.challenge ?? "" });
        return;
      }

      await this.handleMessageEvent(decoded);
      this.writeRaw(res, 200, EVENT_OK);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.writeJson(res, 400, { code: 400, msg });
    }
  }

  private async handleMessageEvent(payload: FeishuEventEnvelope): Promise<void> {
    if (payload.header?.event_type !== "im.message.receive_v1") {
      return;
    }

    const event = payload.event;
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

  private decodeEnvelope(payload: FeishuEventEnvelope): FeishuEventEnvelope {
    if (payload.encrypt) {
      if (!this.config.encryptKey.trim()) {
        throw new Error("received encrypted event but channels.feishu.encryptKey is empty");
      }
      return this.decryptPayload(payload.encrypt);
    }
    return payload;
  }

  private decryptPayload(encrypt: string): FeishuEventEnvelope {
    const key = Buffer.from(`${this.config.encryptKey}=`, "base64");
    if (key.length !== 32) {
      throw new Error("invalid encryptKey for Feishu event decryption");
    }
    const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
    const decrypted = Buffer.concat([decipher.update(encrypt, "base64"), decipher.final()]);
    if (decrypted.length < 20) {
      throw new Error("invalid encrypted payload");
    }
    const msgLength = decrypted.readUInt32BE(16);
    const payloadStart = 20;
    const payloadEnd = payloadStart + msgLength;
    if (payloadEnd > decrypted.length) {
      throw new Error("invalid decrypted payload length");
    }
    const jsonText = decrypted.subarray(payloadStart, payloadEnd).toString("utf8");
    const parsed = JSON.parse(jsonText) as unknown;
    return this.asObject(parsed) as FeishuEventEnvelope;
  }

  private verifyToken(token: string | undefined): boolean {
    const expected = this.config.verificationToken.trim();
    if (!expected) {
      return true;
    }
    return token === expected;
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

  private async readJsonBody(req: IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > MAX_BODY_BYTES) {
        throw new Error("request body too large");
      }
      chunks.push(buf);
    }
    if (chunks.length === 0) {
      return {};
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return JSON.parse(text);
  }

  private asObject(value: unknown): Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private normalizePath(url: string): string {
    const q = url.indexOf("?");
    return q >= 0 ? url.slice(0, q) : url;
  }

  private writeRaw(res: ServerResponse, status: number, body: string): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(body);
  }

  private writeJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
    this.writeRaw(res, status, JSON.stringify(body));
  }
}
