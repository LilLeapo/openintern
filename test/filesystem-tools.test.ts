import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
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

  it("returns a safe error for binary files", async () => {
    const workspace = await makeWorkspace();
    const pngPath = path.join(workspace, "image.png");
    const tool = new ReadFileTool(workspace, workspace);
    await writeFile(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));

    const output = await tool.execute({
      path: "image.png",
    });

    expect(output).toContain("File appears to be binary");
    expect(output).toContain("image/png");
  });
});
