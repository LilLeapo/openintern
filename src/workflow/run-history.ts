import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkflowRunSnapshot } from "./engine.js";

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;

interface StoredRunRecord {
  updatedAt: string;
  snapshot: WorkflowRunSnapshot;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WorkflowRunHistoryRepository {
  private readonly workspace: string;
  private readonly runsDir: string;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
    this.runsDir = this.resolveWithinWorkspace(path.join("workflows", "runs"));
  }

  async save(snapshot: WorkflowRunSnapshot): Promise<string> {
    const runId = this.validateRunId(snapshot.runId);
    await mkdir(this.runsDir, { recursive: true });
    const target = this.resolveRunPath(runId);
    const temp = `${target}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 6)}.tmp`;
    const payload: StoredRunRecord = {
      updatedAt: new Date().toISOString(),
      snapshot,
    };
    await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(temp, target);
    return target;
  }

  async load(runId: string): Promise<WorkflowRunSnapshot | null> {
    let id: string;
    try {
      id = this.validateRunId(runId);
    } catch {
      return null;
    }
    const filePath = this.resolveRunPath(id);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return null;
      }
      throw new Error(`Failed to read workflow run '${id}': ${message}`);
    }
    return this.parseSnapshot(raw);
  }

  async list(options?: { limit?: number }): Promise<WorkflowRunSnapshot[]> {
    await mkdir(this.runsDir, { recursive: true });
    let names: string[];
    try {
      names = await readdir(this.runsDir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return [];
      }
      throw new Error(`Failed to list workflow runs: ${message}`);
    }

    const rows: WorkflowRunSnapshot[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const runId = name.slice(0, -5);
      if (!SAFE_RUN_ID.test(runId)) {
        continue;
      }
      const filePath = this.resolveRunPath(runId);
      try {
        const raw = await readFile(filePath, "utf8");
        const snapshot = this.parseSnapshot(raw);
        if (snapshot) {
          rows.push(snapshot);
        }
      } catch {
        // Skip unreadable/corrupted entries.
      }
    }

    rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const limit = options?.limit;
    if (!limit || limit <= 0) {
      return rows;
    }
    return rows.slice(0, limit);
  }

  private parseSnapshot(raw: string): WorkflowRunSnapshot | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!isObject(parsed)) {
      return null;
    }

    if ("snapshot" in parsed && isObject(parsed.snapshot)) {
      return parsed.snapshot as unknown as WorkflowRunSnapshot;
    }
    if ("runId" in parsed && typeof parsed.runId === "string") {
      return parsed as unknown as WorkflowRunSnapshot;
    }
    return null;
  }

  private validateRunId(value: string): string {
    const id = value.trim();
    if (!id) {
      throw new Error("run_id cannot be empty.");
    }
    if (!SAFE_RUN_ID.test(id)) {
      throw new Error("run_id must match /^[A-Za-z0-9_-]+$/.");
    }
    return id;
  }

  private resolveRunPath(runId: string): string {
    const id = this.validateRunId(runId);
    return this.resolveWithinWorkspace(path.join("workflows", "runs", `${id}.json`));
  }

  private resolveWithinWorkspace(relPath: string): string {
    const absolute = path.resolve(this.workspace, relPath);
    const rel = path.relative(this.workspace, absolute);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Access denied: run history path escapes workspace.");
    }
    return absolute;
  }
}
