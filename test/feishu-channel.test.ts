import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OutboundMessage } from "../src/bus/events.js";
import { MessageBus } from "../src/bus/message-bus.js";
import { FeishuChannel } from "../src/channels/feishu.js";
import type { FeishuChannelConfig } from "../src/config/schema.js";

async function pickFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to allocate free port"));
        return;
      }
      const port = addr.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

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
  });

  it("handles url verification challenge", async () => {
    const bus = new MessageBus();
    const port = await pickFreePort();
    const channel = new FeishuChannel({
      config: makeConfig(),
      bus,
      host: "127.0.0.1",
      port,
    });
    await channel.start();

    const response = await fetch(`http://127.0.0.1:${port}/feishu/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "url_verification",
        token: "verify-token",
        challenge: "challenge-123",
      }),
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.challenge).toBe("challenge-123");
    expect(bus.inboundSize).toBe(0);

    await channel.stop();
  });

  it("publishes inbound message event to bus when sender is allowed", async () => {
    const bus = new MessageBus();
    const port = await pickFreePort();
    const channel = new FeishuChannel({
      config: makeConfig({ allowFrom: ["ou_allowed"] }),
      bus,
      host: "127.0.0.1",
      port,
    });
    await channel.start();

    const response = await fetch(`http://127.0.0.1:${port}/feishu/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schema: "2.0",
        header: {
          event_type: "im.message.receive_v1",
        },
        event: {
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
        },
      }),
    });

    expect(response.status).toBe(200);
    const inbound = await bus.consumeInbound(1000);
    expect(inbound?.channel).toBe("feishu");
    expect(inbound?.senderId).toBe("ou_allowed");
    expect(inbound?.chatId).toBe("ou_allowed");
    expect(inbound?.content).toBe("hello from feishu");
    expect(inbound?.metadata?.message_id).toBe("om_1");

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
      host: "127.0.0.1",
      port: 18080,
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
