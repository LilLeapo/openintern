import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_CONFIG } from "../src/config/schema.js";
import {
  DraftWorkflowTool,
  QueryWorkflowStatusTool,
  TriggerWorkflowTool,
} from "../src/tools/builtins/workflow.js";
import { MessageBus } from "../src/bus/message-bus.js";
import { WorkflowEngine } from "../src/workflow/engine.js";
import { WorkflowRepository } from "../src/workflow/repository.js";
import { parseWorkflowDefinition } from "../src/workflow/schema.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

class FakeSubagentManager {
  private seq = 0;

  async spawnTask(): Promise<{
    taskId: string;
    label: string;
    queued: boolean;
    queuePosition: number | null;
    ack: string;
  }> {
    this.seq += 1;
    return {
      taskId: `task_${this.seq}`,
      label: `task_${this.seq}`,
      queued: false,
      queuePosition: null,
      ack: "started",
    };
  }
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

describe("workflow builtin tools", () => {
  it("trigger_workflow starts a published workflow and query_workflow_status returns snapshot", async () => {
    const workspace = await makeWorkspace();
    const workflowsDir = path.join(workspace, "workflows");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(
      path.join(workflowsDir, "wf_demo.json"),
      JSON.stringify(
        {
          id: "wf_demo",
          trigger: { type: "manual" },
          nodes: [
            {
              id: "node_main",
              role: "scientist",
              taskPrompt: "Process {{trigger.input}}",
              dependsOn: [],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const runtime = new WorkflowEngine({
      bus: new MessageBus(),
      subagents: new FakeSubagentManager(),
      workspace,
      config: structuredClone(DEFAULT_CONFIG),
    });
    const repository = new WorkflowRepository(workspace);

    const trigger = new TriggerWorkflowTool(runtime, repository);
    trigger.setContext("feishu", "chat_001");

    const triggerRaw = await trigger.execute({
      workflow_id: "wf_demo",
      trigger_input: {
        input: "hello",
      },
    });

    const triggerResult = JSON.parse(triggerRaw) as Record<string, unknown>;
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.workflow_id).toBe("wf_demo");
    expect(typeof triggerResult.instance_id).toBe("string");

    const instanceId = String(triggerResult.instance_id);
    const query = new QueryWorkflowStatusTool(runtime);
    const queryRaw = await query.execute({ instance_id: instanceId });
    const queryResult = JSON.parse(queryRaw) as {
      ok: boolean;
      summary: string;
      snapshot: {
        runId: string;
        status: string;
      };
    };

    expect(queryResult.ok).toBe(true);
    expect(queryResult.summary).toContain("running");
    expect(queryResult.snapshot.runId).toBe(instanceId);
    expect(queryResult.snapshot.status).toBe("running");

    runtime.close();
  });

  it("trigger_workflow returns error when published workflow file is missing", async () => {
    const workspace = await makeWorkspace();
    const runtime = new WorkflowEngine({
      bus: new MessageBus(),
      subagents: new FakeSubagentManager(),
      workspace,
      config: structuredClone(DEFAULT_CONFIG),
    });

    const trigger = new TriggerWorkflowTool(runtime, new WorkflowRepository(workspace));
    const output = await trigger.execute({ workflow_id: "not_exists" });

    expect(output.startsWith("Error:")).toBe(true);
    expect(output).toContain("not found");

    runtime.close();
  });

  it("draft_workflow creates a valid draft from instruction", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);
    const tool = new DraftWorkflowTool(repository, "0.0.0.0", 18790);

    const raw = await tool.execute({
      instruction: "Analyze uploaded CSV and return a summary in JSON.",
      workflow_id: "wf_ingest",
    });
    const result = JSON.parse(raw) as {
      ok: boolean;
      draft_id: string;
      path: string;
      review_url: string;
    };

    expect(result.ok).toBe(true);
    expect(result.draft_id.startsWith("wf_ingest_")).toBe(true);
    expect(result.path).toContain(path.join("workflows", "drafts"));
    expect(result.review_url).toContain(`/workflow?draft=${result.draft_id}`);
    expect(result.review_url.startsWith("http://127.0.0.1:18791")).toBe(true);

    const stored = await readFile(result.path, "utf8");
    const parsed = JSON.parse(stored);
    expect(() => parseWorkflowDefinition(parsed)).not.toThrow();
  });

  it("draft_workflow returns executable validation hint for invalid workflow_json", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);
    const tool = new DraftWorkflowTool(repository, "127.0.0.1", 18790);

    const output = await tool.execute({
      instruction: "build workflow",
      workflow_json: {
        id: "wf_bad",
        trigger: { type: "manual" },
        nodes: [
          {
            id: "node_bad",
            taskPrompt: "Do something",
            dependsOn: [],
          },
        ],
      },
    });

    expect(output.startsWith("Error: Invalid workflow_json.")).toBe(true);
    expect(output).toContain("role");
    expect(output).toContain("Common mistakes to avoid");
  });

  it("query_workflow_status returns not found for unknown instance", async () => {
    const query = new QueryWorkflowStatusTool({
      getRunSnapshot: () => null,
      start: async () => {
        throw new Error("not implemented");
      },
    });

    const output = await query.execute({ instance_id: "missing" });
    expect(output).toContain("not found");
  });

  it("query_workflow_status falls back to persisted history", async () => {
    const query = new QueryWorkflowStatusTool(
      {
        getRunSnapshot: () => null,
        start: async () => {
          throw new Error("not implemented");
        },
      },
      {
        load: async () => ({
          runId: "run_1",
          workflowId: "wf_demo",
          status: "failed",
          startedAt: "2026-03-05T10:00:00.000Z",
          endedAt: "2026-03-05T10:01:00.000Z",
          error: "boom",
          execution: {
            mode: "serial",
            maxParallel: 1,
          },
          triggerInput: {},
          originChannel: "cli",
          originChatId: "direct",
          activeTaskIds: [],
          outputs: {},
          approvals: [],
          nodes: [
            {
              id: "node_1",
              status: "failed",
              attempt: 1,
              maxAttempts: 1,
              currentTaskId: null,
              lastError: "boom",
            },
          ],
        }),
      },
    );

    const output = await query.execute({ instance_id: "run_1" });
    const parsed = JSON.parse(output) as { ok: boolean; from_history: boolean };
    expect(parsed.ok).toBe(true);
    expect(parsed.from_history).toBe(true);
  });
});
