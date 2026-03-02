import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SubagentManager } from "../src/agent/subagent/manager.js";
import { MessageBus } from "../src/bus/message-bus.js";
import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";

class StaticProvider implements LLMProvider {
  constructor(private readonly content: string) {}

  getDefaultModel(): string {
    return "static";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    return {
      content: this.content,
      toolCalls: [],
    };
  }
}

class BlockingProvider implements LLMProvider {
  getDefaultModel(): string {
    return "blocking";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 10_000);
      request.signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
    return {
      content: "done",
      toolCalls: [],
    };
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "subagent-manager-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("SubagentManager", () => {
  it("announces completion to system inbound", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const manager = new SubagentManager({
      provider: new StaticProvider("sub done"),
      workspace,
      bus,
      model: "static",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
    });

    const ack = await manager.spawn({
      task: "quick task",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    expect(ack).toContain("started");

    const inbound = await bus.consumeInbound(1000);
    expect(inbound?.channel).toBe("system");
    expect(inbound?.senderId).toBe("subagent");
    expect(inbound?.content).toContain("sub done");
  });

  it("cancels running subagents by session", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const manager = new SubagentManager({
      provider: new BlockingProvider(),
      workspace,
      bus,
      model: "blocking",
      temperature: 0.1,
      maxTokens: 128,
      reasoningEffort: null,
    });

    await manager.spawn({
      task: "long task",
      originChannel: "cli",
      originChatId: "direct",
      sessionKey: "cli:direct",
    });
    const cancelled = await manager.cancelBySession("cli:direct");
    expect(cancelled).toBe(1);
  });
});

