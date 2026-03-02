import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CronService } from "../src/cron/service.js";
import { CronTool } from "../src/tools/builtins/cron.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cron-tool-test-"));
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

describe("CronTool", () => {
  it("supports add/list/remove actions", async () => {
    const dir = await makeTempDir();
    const cron = new CronService(path.join(dir, "jobs.json"));
    const tool = new CronTool(cron);
    tool.setContext("cli", "direct");

    const addRes = await tool.execute({
      action: "add",
      message: "remind me",
      every_seconds: 1,
    });
    expect(addRes).toContain("Created job");

    const listRes = await tool.execute({ action: "list" });
    expect(listRes).toContain("Scheduled jobs:");

    const idMatch = addRes.match(/\(id: ([^)]+)\)/);
    expect(idMatch).not.toBeNull();
    const removeRes = await tool.execute({
      action: "remove",
      job_id: idMatch?.[1],
    });
    expect(removeRes).toContain("Removed job");
  });
});

