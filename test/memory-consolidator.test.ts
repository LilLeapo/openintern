import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";
import { MemoryConsolidator } from "../src/agent/memory/consolidator.js";
import { MemoryStore } from "../src/agent/memory/store.js";
import { Session } from "../src/agent/session/session-store.js";

class ScriptProvider implements LLMProvider {
  constructor(private readonly response: LLMResponse) {}

  getDefaultModel(): string {
    return "scripted";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    return this.response;
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "memory-consolidator-test-"));
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

describe("memory consolidator", () => {
  it("writes history and memory when provider calls save_memory", async () => {
    const workspace = await makeWorkspace();
    const store = new MemoryStore(workspace);
    const consolidator = new MemoryConsolidator(store);
    const session = new Session("cli:test");
    session.messages.push({
      role: "user",
      content: "hello",
      timestamp: "2026-03-02T00:00:00.000Z",
    });

    const ok = await consolidator.consolidate({
      session,
      provider: new ScriptProvider({
        content: null,
        toolCalls: [
          {
            id: "tc_1",
            name: "save_memory",
            arguments: {
              history_entry: "[2026-03-02 00:00] greeted",
              memory_update: "# Memory\n- greeted user",
            },
          },
        ],
      }),
      model: "x",
      archiveAll: true,
    });

    expect(ok).toBe(true);
    const memory = await readFile(path.join(workspace, "memory", "MEMORY.md"), "utf8");
    const history = await readFile(path.join(workspace, "memory", "HISTORY.md"), "utf8");
    expect(memory).toContain("greeted user");
    expect(history).toContain("greeted");
  });

  it("returns false when provider does not call save_memory", async () => {
    const workspace = await makeWorkspace();
    const store = new MemoryStore(workspace);
    const consolidator = new MemoryConsolidator(store);
    const session = new Session("cli:test");
    session.messages.push({
      role: "user",
      content: "hello",
      timestamp: "2026-03-02T00:00:00.000Z",
    });

    const ok = await consolidator.consolidate({
      session,
      provider: new ScriptProvider({
        content: "no tool call",
        toolCalls: [],
      }),
      model: "x",
      archiveAll: true,
    });
    expect(ok).toBe(false);
  });
});

