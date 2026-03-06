import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkflowRepository } from "../src/workflow/repository.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "workflow-repository-test-"));
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

describe("WorkflowRepository listing/publish", () => {
  it("lists drafts and published workflows", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    await repository.saveDraft("wf_draft_a", {
      id: "wf_draft_a",
      trigger: { type: "manual" },
      nodes: [],
    });
    await repository.savePublished("wf_pub_a", {
      id: "wf_pub_a",
      trigger: { type: "manual" },
      nodes: [],
    });

    const drafts = await repository.listDrafts();
    const published = await repository.listPublished();

    expect(drafts.some((item) => item.draftId === "wf_draft_a")).toBe(true);
    expect(published.some((item) => item.workflowId === "wf_pub_a")).toBe(true);
  });

  it("savePublished enforces overwrite flag", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    await repository.savePublished("wf_pub", {
      id: "wf_pub",
      trigger: { type: "manual" },
      nodes: [],
    });

    await expect(
      repository.savePublished("wf_pub", {
        id: "wf_pub",
        trigger: { type: "manual" },
        nodes: [{ id: "node_main" }],
      }),
    ).rejects.toThrow("already exists");

    await expect(
      repository.savePublished(
        "wf_pub",
        {
          id: "wf_pub",
          trigger: { type: "manual" },
          nodes: [{ id: "node_main" }],
        },
        { overwrite: true },
      ),
    ).resolves.toContain(path.join("workflows", "wf_pub.json"));
  });

  it("ignores non-json files in listing", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    const workflowsDir = path.join(workspace, "workflows");
    await mkdir(workflowsDir, { recursive: true });
    await writeFile(path.join(workflowsDir, "README.txt"), "hello", "utf8");

    const rows = await repository.listPublished();
    expect(rows).toHaveLength(0);
  });

  it("rejects unsafe ids", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    await expect(repository.loadDraft("../escape")).rejects.toThrow("must match");
    expect(() => repository.resolvePublishedPath("../escape")).toThrow("must match");
  });
});
