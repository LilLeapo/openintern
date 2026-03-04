import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DraftWorkflowTool,
  MIN_WORKFLOW_EXAMPLE,
  WORKFLOW_SCHEMA_HINT,
} from "../src/tools/builtins/workflow.js";
import { WorkflowRepository } from "../src/workflow/repository.js";
import { parseWorkflowDefinition } from "../src/workflow/schema.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-hint-test-"));
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

describe("workflow schema hint", () => {
  it("draft_workflow description includes key schema constraints", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);
    const tool = new DraftWorkflowTool(repository, "127.0.0.1", 18790);

    expect(tool.description).toContain("role");
    expect(tool.description).toContain("taskPrompt");
    expect(tool.description).toContain("dependsOn");
    expect(tool.description).toContain("highRiskTools");
    expect(tool.description).toContain("Common mistakes to avoid");
    expect(tool.description).toContain(WORKFLOW_SCHEMA_HINT);
  });

  it("minimal workflow example in hint is parseable", () => {
    expect(() => parseWorkflowDefinition(MIN_WORKFLOW_EXAMPLE)).not.toThrow();
  });
});
