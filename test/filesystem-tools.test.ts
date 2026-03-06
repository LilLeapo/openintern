import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ReadFileTool, WriteFileTool } from "../src/tools/builtins/filesystem.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "filesystem-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
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

describe("filesystem tools sandbox", () => {
  it("blocks traversal outside allowedDir for write_file", async () => {
    const workspace = await makeWorkspace();
    const taskWorkspace = path.join(workspace, "tasks", "task-1");
    const tool = new WriteFileTool(taskWorkspace, taskWorkspace);

    const output = await tool.execute({
      path: "../../escape.txt",
      content: "unsafe",
    });

    expect(output).toContain("Access denied");
    expect(await pathExists(path.join(workspace, "escape.txt"))).toBe(false);
  });

  it("blocks traversal outside allowedDir for read_file", async () => {
    const workspace = await makeWorkspace();
    const taskWorkspace = path.join(workspace, "tasks", "task-1");
    const tool = new ReadFileTool(taskWorkspace, taskWorkspace);

    const output = await tool.execute({
      path: "../../config.json",
    });

    expect(output).toContain("Access denied");
  });
});
