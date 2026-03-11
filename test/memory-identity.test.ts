import { describe, expect, it } from "vitest";

import {
  buildLocalMemoryNamespace,
  buildMemuUserId,
  resolveMemoryIdentity,
} from "../src/agent/memory/identity.js";
import type { MemoryConfig } from "../src/config/schema.js";

const memoryConfig: MemoryConfig = {
  isolation: {
    tenantId: "acme",
    scopeOwners: {
      chat: "principal",
      papers: "conversation",
    },
  },
  memu: {
    enabled: true,
    apiKey: "",
    baseUrl: "https://api.memu.so",
    agentId: "openintern",
    scopes: {
      chat: "chat",
      papers: "papers",
    },
    timeoutMs: 1_000,
    retrieve: true,
    memorize: true,
    memorizeMode: "tool",
    apiStyle: "cloudV3",
    endpoints: {},
  },
};

describe("memory identity", () => {
  it("uses tenant plus sender principal for chat scope", () => {
    const identity = resolveMemoryIdentity(
      {
        channel: "feishu",
        chatId: "chat_1",
        senderId: "ou_123",
        scope: "chat",
      },
      memoryConfig,
    );

    expect(identity.tenantId).toBe("acme");
    expect(identity.principalId).toBe("feishu:ou_123");
    expect(identity.ownerType).toBe("principal");
    expect(buildMemuUserId(identity)).toBe("tenant:acme:principal:feishu:ou_123");
  });

  it("can route papers scope to a shared knowledge base via metadata", () => {
    const config: MemoryConfig = {
      ...memoryConfig,
      isolation: {
        tenantId: "acme",
        scopeOwners: {
          chat: "principal",
          papers: "knowledgeBase",
        },
      },
    };
    const identity = resolveMemoryIdentity(
      {
        channel: "feishu",
        chatId: "chat_1",
        senderId: "ou_123",
        metadata: {
          knowledge_base_id: "kb-finance",
        },
        scope: "papers",
      },
      config,
    );

    expect(identity.ownerType).toBe("knowledgeBase");
    expect(identity.ownerId).toBe("kb-finance");
    expect(buildMemuUserId(identity)).toBe("tenant:acme:knowledgeBase:kb-finance");
  });

  it("isolates local summary files per session namespace", () => {
    expect(buildLocalMemoryNamespace("cli:room-1")).toBe("sessions/cli:room-1");
    expect(buildLocalMemoryNamespace("feishu:chat_1")).toBe("sessions/feishu:chat_1");
  });
});
