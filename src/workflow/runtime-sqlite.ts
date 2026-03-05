import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { WorkflowApprovalSnapshot, WorkflowRunSnapshot } from "./engine.js";
import type { RuntimeRunActivity, RuntimeTraceEvent } from "../ui/runtime-state.js";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const require = createRequire(import.meta.url);

interface DatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): {
    run: (...args: unknown[]) => unknown;
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
    all: (...args: unknown[]) => Array<Record<string, unknown>>;
  };
  close(): void;
}

type DatabaseSyncCtor = new (path: string) => DatabaseLike;

function loadDatabaseSyncCtor(): DatabaseSyncCtor | null {
  try {
    const mod = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
    return typeof mod.DatabaseSync === "function" ? mod.DatabaseSync : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRow<T>(row: Record<string, unknown> | undefined): T | null {
  if (!row) {
    return null;
  }
  if (typeof row.payload_json !== "string") {
    return null;
  }
  try {
    return JSON.parse(row.payload_json) as T;
  } catch {
    return null;
  }
}

function parseJsonRows<T>(rows: Array<Record<string, unknown>>): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const parsed = parseJsonRow<T>(row);
    if (parsed) {
      out.push(parsed);
    }
  }
  return out;
}

export class RuntimeSqliteStore {
  private readonly workspace: string;
  private readonly dbPath: string;
  readonly available: boolean;
  private readonly db: DatabaseLike | null;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
    this.dbPath = this.resolveWithinWorkspace(path.join("runtime", "runtime.db"));
    const DatabaseSync = loadDatabaseSyncCtor();
    if (!DatabaseSync) {
      this.available = false;
      this.db = null;
      return;
    }
    this.available = true;
    mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA temp_store = MEMORY;");
    this.migrate();
  }

  close(): void {
    this.db?.close();
  }

  upsertRun(run: WorkflowRunSnapshot): void {
    if (!this.db) {
      return;
    }
    const runId = this.validateId(run.runId, "run_id");
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO runtime_runs (run_id, workflow_id, status, started_at, ended_at, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        workflow_id = excluded.workflow_id,
        status = excluded.status,
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
    stmt.run(
      runId,
      run.workflowId,
      run.status,
      run.startedAt,
      run.endedAt,
      now,
      JSON.stringify(run),
    );
  }

  getRun(runId: string): WorkflowRunSnapshot | null {
    if (!this.db) {
      return null;
    }
    let id: string;
    try {
      id = this.validateId(runId, "run_id");
    } catch {
      return null;
    }
    const stmt = this.db.prepare(
      "SELECT payload_json FROM runtime_runs WHERE run_id = ? LIMIT 1",
    );
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return parseJsonRow<WorkflowRunSnapshot>(row);
  }

  listRuns(options?: { limit?: number }): WorkflowRunSnapshot[] {
    if (!this.db) {
      return [];
    }
    const limit = options?.limit;
    if (limit && limit > 0) {
      const stmt = this.db.prepare(
        "SELECT payload_json FROM runtime_runs ORDER BY started_at DESC LIMIT ?",
      );
      const rows = stmt.all(limit) as Array<Record<string, unknown>>;
      return parseJsonRows<WorkflowRunSnapshot>(rows);
    }
    const stmt = this.db.prepare("SELECT payload_json FROM runtime_runs ORDER BY started_at DESC");
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return parseJsonRows<WorkflowRunSnapshot>(rows);
  }

  upsertTrace(trace: RuntimeTraceEvent): void {
    if (!this.db) {
      return;
    }
    const traceId = this.validateId(trace.id, "trace_id");
    const stmt = this.db.prepare(`
      INSERT INTO runtime_traces (trace_id, run_id, timestamp, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(trace_id) DO UPDATE SET
        run_id = excluded.run_id,
        timestamp = excluded.timestamp,
        payload_json = excluded.payload_json
    `);
    stmt.run(traceId, trace.runId, trace.timestamp, JSON.stringify(trace));
  }

  listTraces(options?: { runId?: string; limit?: number }): RuntimeTraceEvent[] {
    if (!this.db) {
      return [];
    }
    const runId = options?.runId?.trim();
    const limit = options?.limit;
    if (runId && limit && limit > 0) {
      const stmt = this.db.prepare(
        "SELECT payload_json FROM runtime_traces WHERE run_id = ? ORDER BY timestamp DESC LIMIT ?",
      );
      const rows = stmt.all(runId, limit) as Array<Record<string, unknown>>;
      return parseJsonRows<RuntimeTraceEvent>(rows);
    }
    if (runId) {
      const stmt = this.db.prepare(
        "SELECT payload_json FROM runtime_traces WHERE run_id = ? ORDER BY timestamp DESC",
      );
      const rows = stmt.all(runId) as Array<Record<string, unknown>>;
      return parseJsonRows<RuntimeTraceEvent>(rows);
    }
    if (limit && limit > 0) {
      const stmt = this.db.prepare(
        "SELECT payload_json FROM runtime_traces ORDER BY timestamp DESC LIMIT ?",
      );
      const rows = stmt.all(limit) as Array<Record<string, unknown>>;
      return parseJsonRows<RuntimeTraceEvent>(rows);
    }
    const stmt = this.db.prepare("SELECT payload_json FROM runtime_traces ORDER BY timestamp DESC");
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return parseJsonRows<RuntimeTraceEvent>(rows);
  }

  upsertActivity(activity: RuntimeRunActivity): void {
    if (!this.db) {
      return;
    }
    const activityId = this.validateId(activity.id, "activity_id");
    const stmt = this.db.prepare(`
      INSERT INTO runtime_activities (activity_id, run_id, timestamp, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(activity_id) DO UPDATE SET
        run_id = excluded.run_id,
        timestamp = excluded.timestamp,
        payload_json = excluded.payload_json
    `);
    stmt.run(activityId, activity.runId, activity.timestamp, JSON.stringify(activity));
  }

  listActivities(options: { runId: string; limit?: number }): RuntimeRunActivity[] {
    if (!this.db) {
      return [];
    }
    let runId: string;
    try {
      runId = this.validateId(options.runId, "run_id");
    } catch {
      return [];
    }
    const limit = options.limit;
    if (limit && limit > 0) {
      const stmt = this.db.prepare(
        "SELECT payload_json FROM runtime_activities WHERE run_id = ? ORDER BY timestamp DESC LIMIT ?",
      );
      const rows = stmt.all(runId, limit) as Array<Record<string, unknown>>;
      return parseJsonRows<RuntimeRunActivity>(rows);
    }
    const stmt = this.db.prepare(
      "SELECT payload_json FROM runtime_activities WHERE run_id = ? ORDER BY timestamp DESC",
    );
    const rows = stmt.all(runId) as Array<Record<string, unknown>>;
    return parseJsonRows<RuntimeRunActivity>(rows);
  }

  upsertApproval(approval: WorkflowApprovalSnapshot): void {
    if (!this.db) {
      return;
    }
    const approvalId = this.validateId(approval.approvalId, "approval_id");
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO runtime_approvals (approval_id, run_id, requested_at, status, updated_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(approval_id) DO UPDATE SET
        run_id = excluded.run_id,
        requested_at = excluded.requested_at,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `);
    stmt.run(
      approvalId,
      approval.runId,
      approval.requestedAt,
      approval.status,
      now,
      JSON.stringify(approval),
    );
  }

  listApprovals(options?: { pendingOnly?: boolean; limit?: number }): WorkflowApprovalSnapshot[] {
    if (!this.db) {
      return [];
    }
    const pendingOnly = options?.pendingOnly === true;
    const limit = options?.limit;
    const where = pendingOnly ? "WHERE status = 'pending'" : "";
    if (limit && limit > 0) {
      const stmt = this.db.prepare(
        `SELECT payload_json FROM runtime_approvals ${where} ORDER BY requested_at DESC LIMIT ?`,
      );
      const rows = stmt.all(limit) as Array<Record<string, unknown>>;
      return parseJsonRows<WorkflowApprovalSnapshot>(rows);
    }
    const stmt = this.db.prepare(
      `SELECT payload_json FROM runtime_approvals ${where} ORDER BY requested_at DESC`,
    );
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return parseJsonRows<WorkflowApprovalSnapshot>(rows);
  }

  private migrate(): void {
    if (!this.db) {
      return;
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_runs (
        run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_runs_started_at ON runtime_runs(started_at DESC);

      CREATE TABLE IF NOT EXISTS runtime_traces (
        trace_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_traces_run_ts ON runtime_traces(run_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS runtime_activities (
        activity_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_activities_run_ts ON runtime_activities(run_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS runtime_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_approvals_requested_at ON runtime_approvals(requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runtime_approvals_status ON runtime_approvals(status);
    `);
  }

  private validateId(input: string, label: string): string {
    const value = input.trim();
    if (!value) {
      throw new Error(`${label} cannot be empty.`);
    }
    if (!SAFE_ID.test(value)) {
      throw new Error(`${label} must match /^[A-Za-z0-9_-]+$/.`);
    }
    return value;
  }

  private resolveWithinWorkspace(relPath: string): string {
    const absolute = path.resolve(this.workspace, relPath);
    const rel = path.relative(this.workspace, absolute);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Access denied: runtime sqlite path escapes workspace.");
    }
    return absolute;
  }
}
