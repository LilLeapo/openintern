import { randomUUID } from "node:crypto";
import { basename, extname } from "node:path";
import { readFile } from "node:fs/promises";

import * as Lark from "@larksuiteoapi/node-sdk";

import type { OutboundMessage } from "../bus/events.js";
import { MessageBus } from "../bus/message-bus.js";
import type { FeishuChannelConfig } from "../config/schema.js";

const TOKEN_REFRESH_SKEW_MS = 60_000;
const TEXT_MAX_LEN = 200;
const POST_MAX_LEN = 2000;
const TABLE_RE =
  /((?:^[ \t]*\|.+\|[ \t]*\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\n)(?:^[ \t]*\|.+\|[ \t]*\n?)+)/gm;
const HEADING_RE = /^(#{1,6})\s+(.+)$/gm;
const CODE_BLOCK_RE = /(```[\s\S]*?```)/gm;
const COMPLEX_MD_RE = /```|^\|.+\|.*\n\s*\|[-:\s|]+\||^#{1,6}\s+/m;
const SIMPLE_MD_RE =
  /\*\*.+?\*\*|__.+?__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|~~.+?~~/s;
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g;
const MD_LINK_DETECT_RE = /\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/;
const LIST_RE = /^[\s]*[-*+]\s+/m;
const OLIST_RE = /^[\s]*\d+\.\s+/m;

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
    const hasText = message.content.trim().length > 0;
    const media = Array.isArray(message.media) ? message.media.filter(Boolean) : [];
    if (!this.config.enabled || (!hasText && media.length === 0)) {
      return;
    }
    if (!this.config.appId || !this.config.appSecret) {
      throw new Error("Feishu channel enabled but appId/appSecret is missing");
    }

    const receiveIdType = this.receiveIdTypeForChat(message.chatId);
    const url =
      `https://open.feishu.cn/open-apis/im/v1/messages?` +
      `receive_id_type=${encodeURIComponent(receiveIdType)}`;
    const sendOps = this.buildOutboundPayloads(message).map((payload) => async (token: string) => {
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
    for (const filePath of media) {
      sendOps.push(async (token: string) => {
        const fileKey = await this.uploadFile(token, filePath);
        if (!fileKey) {
          throw new Error(`Feishu file upload failed for '${filePath}'`);
        }
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            receive_id: message.chatId,
            msg_type: "file",
            content: JSON.stringify({ file_key: fileKey }),
            uuid: randomUUID(),
          }),
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

    await this.withAuthRetry(async (token) => {
      for (const sendOp of sendOps) {
        await sendOp(token);
      }
    });
  }

  private buildOutboundPayloads(message: OutboundMessage): Array<{
    receive_id: string;
    msg_type: "text" | "post" | "interactive";
    content: string;
    uuid: string;
  }> {
    const content = message.content.trim();
    if (!content) {
      return [];
    }
    const format = this.detectMessageFormat(content);

    if (format === "text") {
      return [
        {
          receive_id: message.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: content }),
          uuid: randomUUID(),
        },
      ];
    }

    if (format === "post") {
      return [
        {
          receive_id: message.chatId,
          msg_type: "post",
          content: this.markdownToPost(content),
          uuid: randomUUID(),
        },
      ];
    }

    const elements = this.buildCardElements(content);
    return this.splitElementsByTableLimit(elements).map((chunk) => ({
      receive_id: message.chatId,
      msg_type: "interactive" as const,
      content: JSON.stringify(
        {
          config: {
            wide_screen_mode: true,
          },
          elements: chunk,
        },
        null,
        0,
      ),
      uuid: randomUUID(),
    }));
  }

  private detectMessageFormat(content: string): "text" | "post" | "interactive" {
    const stripped = content.trim();
    if (COMPLEX_MD_RE.test(stripped)) {
      return "interactive";
    }
    if (stripped.length > POST_MAX_LEN) {
      return "interactive";
    }
    if (SIMPLE_MD_RE.test(stripped)) {
      return "interactive";
    }
    if (LIST_RE.test(stripped) || OLIST_RE.test(stripped)) {
      return "interactive";
    }
    if (MD_LINK_DETECT_RE.test(stripped)) {
      return "post";
    }
    if (stripped.length <= TEXT_MAX_LEN) {
      return "text";
    }
    return "post";
  }

  private markdownToPost(content: string): string {
    const paragraphs = content.trim().split("\n").map((line) => {
      const elements: Array<Record<string, string>> = [];
      let lastEnd = 0;
      for (const match of line.matchAll(MD_LINK_RE)) {
        const [fullMatch, text, href] = match;
        const start = match.index ?? 0;
        const before = line.slice(lastEnd, start);
        if (before) {
          elements.push({ tag: "text", text: before });
        }
        elements.push({
          tag: "a",
          text,
          href,
        });
        lastEnd = start + fullMatch.length;
      }
      const remaining = line.slice(lastEnd);
      if (remaining) {
        elements.push({ tag: "text", text: remaining });
      }
      if (elements.length === 0) {
        elements.push({ tag: "text", text: "" });
      }
      return elements;
    });

    return JSON.stringify(
      {
        zh_cn: {
          content: paragraphs,
        },
      },
      null,
      0,
    );
  }

  private buildCardElements(content: string): Array<Record<string, unknown>> {
    const elements: Array<Record<string, unknown>> = [];
    let lastEnd = 0;
    for (const match of content.matchAll(TABLE_RE)) {
      const fullMatch = match[0];
      const start = match.index ?? 0;
      const before = content.slice(lastEnd, start);
      if (before.trim()) {
        elements.push(...this.splitHeadings(before));
      }
      elements.push(this.parseMarkdownTable(fullMatch) ?? { tag: "markdown", content: fullMatch });
      lastEnd = start + fullMatch.length;
    }
    const remaining = content.slice(lastEnd);
    if (remaining.trim()) {
      elements.push(...this.splitHeadings(remaining));
    }
    return elements.length > 0 ? elements : [{ tag: "markdown", content }];
  }

  private parseMarkdownTable(tableText: string): Record<string, unknown> | null {
    const lines = tableText
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 3) {
      return null;
    }

    const splitLine = (line: string): string[] =>
      line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());

    const headers = splitLine(lines[0]);
    const rows = lines.slice(2).map(splitLine);
    return {
      tag: "table",
      page_size: rows.length + 1,
      columns: headers.map((header, index) => ({
        tag: "column",
        name: `c${index}`,
        display_name: header,
        width: "auto",
      })),
      rows: rows.map((row) =>
        Object.fromEntries(headers.map((_, index) => [`c${index}`, row[index] ?? ""])),
      ),
    };
  }

  private splitElementsByTableLimit(
    elements: Array<Record<string, unknown>>,
    maxTables = 1,
  ): Array<Array<Record<string, unknown>>> {
    if (elements.length === 0) {
      return [[]];
    }

    const groups: Array<Array<Record<string, unknown>>> = [];
    let current: Array<Record<string, unknown>> = [];
    let tableCount = 0;

    for (const element of elements) {
      if (element.tag === "table") {
        if (tableCount >= maxTables) {
          if (current.length > 0) {
            groups.push(current);
          }
          current = [];
          tableCount = 0;
        }
        current.push(element);
        tableCount += 1;
        continue;
      }
      current.push(element);
    }

    if (current.length > 0) {
      groups.push(current);
    }
    return groups.length > 0 ? groups : [[]];
  }

  private splitHeadings(content: string): Array<Record<string, unknown>> {
    let protectedContent = content;
    const codeBlocks: string[] = [];
    for (const match of content.matchAll(CODE_BLOCK_RE)) {
      const codeBlock = match[0];
      const marker = `\u0000CODE${codeBlocks.length}\u0000`;
      codeBlocks.push(codeBlock);
      protectedContent = protectedContent.replace(codeBlock, marker);
    }

    const elements: Array<Record<string, unknown>> = [];
    let lastEnd = 0;
    for (const match of protectedContent.matchAll(HEADING_RE)) {
      const text = match[2]?.trim() ?? "";
      const start = match.index ?? 0;
      const before = protectedContent.slice(lastEnd, start).trim();
      if (before) {
        elements.push({ tag: "markdown", content: before });
      }
      elements.push({
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**${text}**`,
        },
      });
      lastEnd = start + match[0].length;
    }
    const remaining = protectedContent.slice(lastEnd).trim();
    if (remaining) {
      elements.push({ tag: "markdown", content: remaining });
    }

    for (let index = 0; index < codeBlocks.length; index += 1) {
      const marker = `\u0000CODE${index}\u0000`;
      for (const element of elements) {
        if (element.tag !== "markdown" || typeof element.content !== "string") {
          continue;
        }
        element.content = element.content.replace(marker, codeBlocks[index]);
      }
    }

    return elements.length > 0 ? elements : [{ tag: "markdown", content }];
  }

  private async uploadFile(token: string, filePath: string): Promise<string | null> {
    const data = await readFile(filePath);
    const fileName = basename(filePath);
    const form = new FormData();
    form.set("file_type", this.fileTypeForPath(filePath));
    form.set("file_name", fileName);
    form.set("file", new Blob([data]), fileName);

    const response = await fetch("https://open.feishu.cn/open-apis/im/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });
    const raw = (await response.json()) as unknown;
    const body = this.asObject(raw);
    const code = typeof body.code === "number" ? body.code : -1;
    if (!response.ok || code !== 0) {
      const msg = typeof body.msg === "string" ? body.msg : response.statusText;
      throw new Error(`Feishu file upload failed (code=${code}, status=${response.status}): ${msg}`);
    }
    const dataObj = this.asObject(body.data);
    return typeof dataObj.file_key === "string" && dataObj.file_key.trim()
      ? dataObj.file_key.trim()
      : null;
  }

  private fileTypeForPath(filePath: string): "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream" {
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
      case ".opus":
        return "opus";
      case ".mp4":
        return "mp4";
      case ".pdf":
        return "pdf";
      case ".doc":
      case ".docx":
        return "doc";
      case ".xls":
      case ".xlsx":
        return "xls";
      case ".ppt":
      case ".pptx":
        return "ppt";
      default:
        return "stream";
    }
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
