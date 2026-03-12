import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { OutboundMessage } from "../src/bus/events.js";
import { MessageBus } from "../src/bus/message-bus.js";
import { FeishuChannel } from "../src/channels/feishu.js";
import type { FeishuChannelConfig } from "../src/config/schema.js";

const sdkState = vi.hoisted(() => ({
  wsStart: vi.fn(async (_params?: unknown) => undefined),
  wsClose: vi.fn((_params?: unknown) => undefined),
  registeredHandlers: {} as Record<string, (payload: unknown) => Promise<unknown> | unknown>,
  lastWsParams: undefined as unknown,
  lastDispatcherParams: undefined as unknown,
}));

vi.mock("@larksuiteoapi/node-sdk", () => {
  class MockEventDispatcher {
    constructor(params: unknown) {
      sdkState.lastDispatcherParams = params;
    }

    register(handles: Record<string, (payload: unknown) => Promise<unknown> | unknown>): this {
      sdkState.registeredHandlers = handles;
      return this;
    }
  }

  class MockWSClient {
    constructor(params: unknown) {
      sdkState.lastWsParams = params;
    }

    async start(params: unknown): Promise<void> {
      await sdkState.wsStart(params);
    }

    close(params?: unknown): void {
      sdkState.wsClose(params);
    }
  }

  return {
    EventDispatcher: MockEventDispatcher,
    WSClient: MockWSClient,
    LoggerLevel: {
      error: 1,
      info: 3,
    },
  };
});

function makeConfig(overrides?: Partial<FeishuChannelConfig>): FeishuChannelConfig {
  return {
    enabled: true,
    appId: "cli_default",
    appSecret: "secret_default",
    verificationToken: "verify-token",
    encryptKey: "",
    allowFrom: ["*"],
    webhookPath: "/feishu/events",
    ...(overrides ?? {}),
  };
}

describe("FeishuChannel", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    sdkState.wsStart.mockClear();
    sdkState.wsClose.mockClear();
    sdkState.registeredHandlers = {};
    sdkState.lastWsParams = undefined;
    sdkState.lastDispatcherParams = undefined;
  });

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("starts long connection with official SDK and closes cleanly", async () => {
    const channel = new FeishuChannel({
      config: makeConfig(),
      bus: new MessageBus(),
    });
    await channel.start();
    expect(sdkState.lastDispatcherParams).toMatchObject({
      verificationToken: "verify-token",
    });
    expect(sdkState.lastWsParams).toMatchObject({
      appId: "cli_default",
      appSecret: "secret_default",
      autoReconnect: true,
    });
    expect(sdkState.wsStart).toHaveBeenCalledTimes(1);

    await channel.stop();
    expect(sdkState.wsClose).toHaveBeenCalledWith({ force: true });
  });

  it("publishes inbound message event to bus from websocket handler", async () => {
    const bus = new MessageBus();
    const channel = new FeishuChannel({
      config: makeConfig({ allowFrom: ["ou_allowed"] }),
      bus,
    });
    await channel.start();

    const handler = sdkState.registeredHandlers["im.message.receive_v1"];
    expect(handler).toBeTruthy();
    await handler?.({
      sender: {
        sender_type: "user",
        sender_id: {
          open_id: "ou_allowed",
        },
      },
      message: {
        message_id: "om_1",
        chat_id: "oc_abc",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello from feishu" }),
      },
    });

    const inbound = await bus.consumeInbound(1000);
    expect(inbound?.channel).toBe("feishu");
    expect(inbound?.senderId).toBe("ou_allowed");
    expect(inbound?.chatId).toBe("ou_allowed");
    expect(inbound?.content).toBe("hello from feishu");
    expect(inbound?.metadata?.message_id).toBe("om_1");

    // Dedup check
    await handler?.({
      sender: {
        sender_type: "user",
        sender_id: {
          open_id: "ou_allowed",
        },
      },
      message: {
        message_id: "om_1",
        chat_id: "oc_abc",
        chat_type: "p2p",
        message_type: "text",
        content: JSON.stringify({ text: "hello from feishu" }),
      },
    });
    const duplicate = await bus.consumeInbound(20);
    expect(duplicate).toBeNull();

    await channel.stop();
  });

  it("sends outbound text message via Feishu open api", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: "tenant-token-1",
            expire: 7200,
          }),
        };
      }
      if (url.includes("/im/v1/messages")) {
        const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
        if (auth !== "Bearer tenant-token-1") {
          return {
            ok: true,
            json: async () => ({ code: 99991663, msg: "invalid access token" }),
          };
        }
        return {
          ok: true,
          json: async () => ({ code: 0, msg: "ok" }),
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: "not found",
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const channel = new FeishuChannel({
      config: makeConfig({
        appId: "cli_123",
        appSecret: "secret_456",
      }),
      bus: new MessageBus(),
    });

    const outbound: OutboundMessage = {
      channel: "feishu",
      chatId: "ou_target",
      content: "hello outbound",
      metadata: {},
    };
    await channel.send(outbound);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/im/v1/messages?receive_id_type=open_id"),
    );
    expect(sendCall).toBeTruthy();
    const payload = JSON.parse(String((sendCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      receive_id: string;
      msg_type: string;
      content: string;
    };
    expect(payload.receive_id).toBe("ou_target");
    expect(payload.msg_type).toBe("text");
    expect(JSON.parse(payload.content).text).toBe("hello outbound");
  });

  it("sends markdown links as Feishu post messages", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: "tenant-token-1",
            expire: 7200,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ code: 0, msg: "ok" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const channel = new FeishuChannel({
      config: makeConfig(),
      bus: new MessageBus(),
    });

    await channel.send({
      channel: "feishu",
      chatId: "ou_target",
      content: "Read [OpenAI](https://openai.com) now",
      metadata: {},
    });

    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/im/v1/messages?receive_id_type=open_id"),
    );
    const payload = JSON.parse(String((sendCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      msg_type: string;
      content: string;
    };
    expect(payload.msg_type).toBe("post");
    const body = JSON.parse(payload.content) as {
      zh_cn: {
        content: Array<Array<Record<string, string>>>;
      };
    };
    expect(body.zh_cn.content[0]?.some((item) => item.tag === "a" && item.href === "https://openai.com")).toBe(true);
  });

  it("sends headings and lists as interactive cards", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: "tenant-token-1",
            expire: 7200,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ code: 0, msg: "ok" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const channel = new FeishuChannel({
      config: makeConfig(),
      bus: new MessageBus(),
    });

    await channel.send({
      channel: "feishu",
      chatId: "ou_target",
      content: "# Title\n\n- first\n- second",
      metadata: {},
    });

    const sendCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/im/v1/messages?receive_id_type=open_id"),
    );
    const payload = JSON.parse(String((sendCall?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      msg_type: string;
      content: string;
    };
    expect(payload.msg_type).toBe("interactive");
    const card = JSON.parse(payload.content) as {
      elements: Array<Record<string, unknown>>;
    };
    expect(card.elements.some((item) => item.tag === "div")).toBe(true);
    expect(card.elements.some((item) => item.tag === "markdown")).toBe(true);
  });

  it("splits multiple markdown tables into multiple interactive cards", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: "tenant-token-1",
            expire: 7200,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ code: 0, msg: "ok" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const channel = new FeishuChannel({
      config: makeConfig(),
      bus: new MessageBus(),
    });

    await channel.send({
      channel: "feishu",
      chatId: "ou_target",
      content:
        "| A |\n| - |\n| 1 |\n\n| B |\n| - |\n| 2 |",
      metadata: {},
    });

    const sendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/im/v1/messages?receive_id_type=open_id"),
    );
    expect(sendCalls).toHaveLength(2);
    const cards = sendCalls.map((call) =>
      JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? "{}")) as {
        msg_type: string;
        content: string;
      },
    );
    expect(cards.every((card) => card.msg_type === "interactive")).toBe(true);
    const parsedCards = cards.map((card) => JSON.parse(card.content) as { elements: Array<Record<string, unknown>> });
    expect(parsedCards.every((card) => card.elements.filter((item) => item.tag === "table").length <= 1)).toBe(true);
  });

  it("uploads media attachments and sends them as files", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "feishu-media-test-"));
    tempDirs.push(dir);
    const filePath = path.join(dir, "report.json");
    await writeFile(filePath, '{"ok":true}\n', "utf8");

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/tenant_access_token/internal")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            tenant_access_token: "tenant-token-1",
            expire: 7200,
          }),
        };
      }
      if (url.includes("/im/v1/files")) {
        return {
          ok: true,
          json: async () => ({
            code: 0,
            data: {
              file_key: "file-key-1",
            },
          }),
        };
      }
      if (url.includes("/im/v1/messages")) {
        return {
          ok: true,
          json: async () => ({ code: 0, msg: "ok" }),
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: "not found",
        json: async () => ({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const channel = new FeishuChannel({
      config: makeConfig(),
      bus: new MessageBus(),
    });

    await channel.send({
      channel: "feishu",
      chatId: "ou_target",
      content: "诊断报告已生成",
      media: [filePath],
      metadata: {},
    });

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/im/v1/files"))).toBe(true);
    const messageCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/im/v1/messages?receive_id_type=open_id"),
    );
    expect(messageCalls).toHaveLength(2);
    const filePayload = messageCalls
      .map((call) => JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? "{}")) as {
        msg_type: string;
        content: string;
      })
      .find((payload) => payload.msg_type === "file");
    expect(filePayload).toBeTruthy();
    expect(JSON.parse(String(filePayload?.content)).file_key).toBe("file-key-1");
  });
});
