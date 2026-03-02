import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentLoop } from "../src/agent/loop.js";
import { MessageBus } from "../src/bus/message-bus.js";
import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";

class AutonomyProvider implements LLMProvider {
  getDefaultModel(): string {
    return "autonomy";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    const messages = request.messages;
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user" && typeof message.content === "string");
    const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
    const hasSpawnToolResult = messages.some(
      (message) => message.role === "tool" && message.name === "spawn",
    );

    if (userText.includes("[Subagent 'sub'")) {
      return {
        content: "Background task finished and summarized.",
        toolCalls: [],
      };
    }

    if (userText.includes("please spawn")) {
      if (!hasSpawnToolResult) {
        return {
          content: null,
          toolCalls: [
            {
              id: "tc_spawn_1",
              name: "spawn",
              arguments: {
                task: "subtask",
                label: "sub",
              },
            },
          ],
        };
      }
      return {
        content: "Spawned background task.",
        toolCalls: [],
      };
    }

    if (userText.includes("subtask")) {
      return {
        content: "Subagent result.",
        toolCalls: [],
      };
    }

    return {
      content: "ok",
      toolCalls: [],
    };
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agent-autonomy-flow-test-"));
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

describe("Agent autonomy flow", () => {
  it("spawns subagent and handles system callback", async () => {
    const workspace = await makeWorkspace();
    const bus = new MessageBus();
    const agent = new AgentLoop({
      bus,
      provider: new AutonomyProvider(),
      workspace,
    });

    const runTask = agent.run();
    await bus.publishInbound({
      channel: "cli",
      senderId: "u1",
      chatId: "direct",
      content: "please spawn this task",
      metadata: {
        message_id: "m1",
      },
    });

    let userFinal = "";
    let systemReply = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (!userFinal || !systemReply)) {
      const outbound = await bus.consumeOutbound(200);
      if (!outbound) {
        continue;
      }
      const meta = (outbound.metadata ?? {}) as Record<string, unknown>;
      if (meta.message_id === "m1" && meta._progress !== true) {
        userFinal = outbound.content;
      } else if (!meta.message_id && outbound.content.includes("Background task finished")) {
        systemReply = outbound.content;
      }
    }

    expect(userFinal).toContain("Spawned background task");
    expect(systemReply).toContain("Background task finished");

    agent.stop();
    await runTask;
  });
});

