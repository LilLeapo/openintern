import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WorkflowRepository } from "../src/workflow/repository.js";
import { loadWorkflowDraftReview } from "../src/ui/draft-api.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ui-draft-api-test-"));
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

describe("ui draft api helper", () => {
  it("loads draft review payload successfully", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);
    await repository.saveDraft("draft_ok", {
      id: "wf_ok",
      trigger: {
        type: "manual",
      },
      nodes: [
        {
          id: "node_main",
          role: "scientist",
          taskPrompt: "Do work",
          dependsOn: [],
        },
      ],
    });

    const payload = await loadWorkflowDraftReview({
      repository,
      draftId: "draft_ok",
      gatewayHost: "0.0.0.0",
      gatewayPort: 18790,
    });

    expect(payload.draftId).toBe("draft_ok");
    expect(payload.valid).toBe(true);
    expect(payload.error).toBeNull();
    expect(payload.normalized?.id).toBe("wf_ok");
    expect(payload.reviewUrl).toBe("http://127.0.0.1:18791/workflow?draft=draft_ok");
    expect(payload.path).toContain(path.join("workflows", "drafts", "draft_ok.json"));
  });

  it("rejects invalid draft id to prevent path traversal", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    await expect(
      loadWorkflowDraftReview({
        repository,
        draftId: "../escape",
        gatewayHost: "127.0.0.1",
        gatewayPort: 18790,
      }),
    ).rejects.toThrow("must match");
  });

  it("returns validation error when draft exists but schema is invalid", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);
    await repository.saveDraft("draft_bad", {
      id: "wf_bad",
      trigger: {
        type: "manual",
      },
      nodes: [
        {
          id: "node_bad",
          taskPrompt: "missing role",
          dependsOn: [],
        },
      ],
    });

    const payload = await loadWorkflowDraftReview({
      repository,
      draftId: "draft_bad",
      gatewayHost: "127.0.0.1",
      gatewayPort: 18790,
    });

    expect(payload.valid).toBe(false);
    expect(payload.normalized).toBeNull();
    expect(payload.error).toContain("role");
  });

  it("throws when draft file does not exist", async () => {
    const workspace = await makeWorkspace();
    const repository = new WorkflowRepository(workspace);

    await expect(
      loadWorkflowDraftReview({
        repository,
        draftId: "not_found",
        gatewayHost: "127.0.0.1",
        gatewayPort: 18790,
      }),
    ).rejects.toThrow("not found");
  });
});
