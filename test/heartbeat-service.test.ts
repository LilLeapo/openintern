import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { HeartbeatService } from "../src/heartbeat/service.js";
import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";

class HeartbeatProvider implements LLMProvider {
  constructor(private readonly action: "skip" | "run", private readonly tasks = "") {}

  getDefaultModel(): string {
    return "heartbeat";
  }

  async chat(_request: ChatRequest): Promise<LLMResponse> {
    return {
      content: null,
      toolCalls: [
        {
          id: "tc_hb_1",
          name: "heartbeat",
          arguments: {
            action: this.action,
            tasks: this.tasks,
          },
        },
      ],
    };
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "heartbeat-service-test-"));
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

describe("HeartbeatService", () => {
  it("triggerNow returns null on skip", async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace, "HEARTBEAT.md"), "no active tasks", "utf8");

    const service = new HeartbeatService({
      workspace,
      provider: new HeartbeatProvider("skip"),
      model: "heartbeat",
      onExecute: async () => "should-not-run",
    });
    expect(await service.triggerNow()).toBeNull();
  });

  it("triggerNow executes tasks on run", async () => {
    const workspace = await makeWorkspace();
    await writeFile(path.join(workspace, "HEARTBEAT.md"), "has tasks", "utf8");

    const service = new HeartbeatService({
      workspace,
      provider: new HeartbeatProvider("run", "do weekly check"),
      model: "heartbeat",
      onExecute: async (tasks) => `executed: ${tasks}`,
    });
    expect(await service.triggerNow()).toBe("executed: do weekly check");
  });
});

