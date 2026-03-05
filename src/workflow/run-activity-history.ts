import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SubagentTaskMessage, SubagentTaskToolCall } from "../bus/events.js";

const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;
const MAX_PERSISTED_ACTIVITIES = 800;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface WorkflowRunActivityRecord {
  id: string;
  runId: string;
  nodeId: string | null;
  taskId: string;
  role: string | null;
  label: string;
  task: string;
  status: "ok" | "error";
  result: string;
  type: "subagent.task.completed" | "subagent.task.failed";
  timestamp: string;
  messages: SubagentTaskMessage[];
  toolCalls: SubagentTaskToolCall[];
}

export class WorkflowRunActivityHistoryRepository {
  private readonly workspace: string;
  private readonly dir: string;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
    this.dir = this.resolveWithinWorkspace(path.join("workflows", "run-activities"));
  }

  async append(runId: string, activity: WorkflowRunActivityRecord): Promise<void> {
    const id = this.validateRunId(runId);
    const current = await this.list(id);
    const next = [activity, ...current.filter((item) => item.id !== activity.id)]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, MAX_PERSISTED_ACTIVITIES);
    await this.writeActivities(id, next);
  }

  async list(runId: string, options?: { limit?: number }): Promise<WorkflowRunActivityRecord[]> {
    let id: string;
    try {
      id = this.validateRunId(runId);
    } catch {
      return [];
    }
    await mkdir(this.dir, { recursive: true });
    const filePath = this.resolvePath(id);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return [];
      }
      throw new Error(`Failed to read workflow run activities '${id}': ${message}`);
    }
    const parsed = this.parse(raw);
    const limit = options?.limit;
    if (!limit || limit <= 0) {
      return parsed;
    }
    return parsed.slice(0, limit);
  }

  private async writeActivities(runId: string, activities: WorkflowRunActivityRecord[]): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = this.resolvePath(runId);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(activities, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  }

  private parse(raw: string): WorkflowRunActivityRecord[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) {
      return [];
    }
    const out: WorkflowRunActivityRecord[] = [];
    for (const item of parsed) {
      if (!isObject(item)) {
        continue;
      }
      const id = typeof item.id === "string" ? item.id : "";
      const runId = typeof item.runId === "string" ? item.runId : "";
      const taskId = typeof item.taskId === "string" ? item.taskId : "";
      if (!id || !runId || !taskId) {
        continue;
      }
      const type =
        item.type === "subagent.task.failed" ? "subagent.task.failed" : "subagent.task.completed";
      const status = item.status === "error" ? "error" : "ok";
      const messages: SubagentTaskMessage[] = [];
      if (Array.isArray(item.messages)) {
        for (const msg of item.messages) {
          if (!isObject(msg)) {
            continue;
          }
          const roleRaw = typeof msg.role === "string" ? msg.role : "";
          const role =
            roleRaw === "system" || roleRaw === "user" || roleRaw === "assistant" || roleRaw === "tool"
              ? roleRaw
              : null;
          if (!role) {
            continue;
          }
          messages.push({
            role,
            content: typeof msg.content === "string" ? msg.content : "",
            at: typeof msg.at === "string" ? msg.at : new Date().toISOString(),
            ...(typeof msg.name === "string" ? { name: msg.name } : {}),
            ...(typeof msg.toolCallId === "string" ? { toolCallId: msg.toolCallId } : {}),
          });
        }
      }
      const toolCalls: SubagentTaskToolCall[] = [];
      if (Array.isArray(item.toolCalls)) {
        for (const toolCall of item.toolCalls) {
          if (!isObject(toolCall)) {
            continue;
          }
          toolCalls.push({
            id: typeof toolCall.id === "string" ? toolCall.id : "",
            name: typeof toolCall.name === "string" ? toolCall.name : "",
            arguments:
              isObject(toolCall.arguments) ? (toolCall.arguments as Record<string, unknown>) : {},
            result: typeof toolCall.result === "string" ? toolCall.result : "",
            highRisk: toolCall.highRisk === true,
            at: typeof toolCall.at === "string" ? toolCall.at : new Date().toISOString(),
          });
        }
      }

      out.push({
        id,
        runId,
        nodeId: typeof item.nodeId === "string" ? item.nodeId : null,
        taskId,
        role: typeof item.role === "string" ? item.role : null,
        label: typeof item.label === "string" ? item.label : "",
        task: typeof item.task === "string" ? item.task : "",
        status,
        result: typeof item.result === "string" ? item.result : "",
        type,
        timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
        messages,
        toolCalls,
      });
    }
    out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return out;
  }

  private validateRunId(input: string): string {
    const value = input.trim();
    if (!value || !SAFE_RUN_ID.test(value)) {
      throw new Error("run_id must match /^[A-Za-z0-9_-]+$/.");
    }
    return value;
  }

  private resolvePath(runId: string): string {
    const id = this.validateRunId(runId);
    return this.resolveWithinWorkspace(path.join("workflows", "run-activities", `${id}.json`));
  }

  private resolveWithinWorkspace(relPath: string): string {
    const absolute = path.resolve(this.workspace, relPath);
    const rel = path.relative(this.workspace, absolute);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Access denied: run activity path escapes workspace.");
    }
    return absolute;
  }
}
