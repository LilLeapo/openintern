import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CronService } from "../src/cron/service.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cron-service-test-"));
  tempDirs.push(dir);
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

describe("CronService", () => {
  it("runs recurring jobs and updates status", async () => {
    const dir = await makeTempDir();
    const storePath = path.join(dir, "jobs.json");
    let executed = 0;
    const cron = new CronService(storePath, async () => {
      executed += 1;
      return null;
    });

    await cron.addJob({
      name: "every-50ms",
      schedule: { kind: "every", everyMs: 50 },
      message: "tick",
    });
    await cron.start();
    await sleep(180);
    cron.stop();

    expect(executed).toBeGreaterThanOrEqual(2);
    const jobs = await cron.listJobs(true);
    expect(jobs[0]?.state.lastStatus).toBe("ok");
    expect(await cron.status()).toEqual({
      jobs: 1,
      running: false,
    });
  });

  it("adds and removes jobs", async () => {
    const dir = await makeTempDir();
    const storePath = path.join(dir, "jobs.json");
    const cron = new CronService(storePath);

    const job = await cron.addJob({
      name: "one-shot",
      schedule: { kind: "at", atMs: Date.now() + 1000 },
      message: "hello",
      deleteAfterRun: true,
    });
    expect((await cron.listJobs(true)).length).toBe(1);
    expect(await cron.removeJob(job.id)).toBe(true);
    expect((await cron.listJobs(true)).length).toBe(0);
  });

  it("rejects invalid cron expression", async () => {
    const dir = await makeTempDir();
    const storePath = path.join(dir, "jobs.json");
    const cron = new CronService(storePath);

    await expect(
      cron.addJob({
        name: "invalid",
        schedule: { kind: "cron", expr: "bad expression" },
        message: "x",
      }),
    ).rejects.toThrow("invalid cron expression");
  });
});

