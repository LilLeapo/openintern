import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => {
    vi.restoreAllMocks();
    sdkState.wsStart.mockClear();
    sdkState.wsClose.mockClear();
    sdkState.registeredHandlers = {};
    sdkState.lastWsParams = undefined;
    sdkState.lastDispatcherParams = undefined;
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
});
