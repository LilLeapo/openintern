import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class WorkflowRepository {
  private readonly workspace: string;

  constructor(workspace: string) {
    this.workspace = path.resolve(workspace);
  }

  async loadPublished(workflowId: string): Promise<unknown> {
    const id = this.validateId(workflowId, "workflow_id");
    const filePath = this.resolvePublishedPath(id);
    return this.readJson(filePath, `Published workflow '${id}'`);
  }

  async loadDraft(draftId: string): Promise<unknown> {
    const id = this.validateId(draftId, "draft_id");
    const filePath = this.resolveDraftPath(id);
    return this.readJson(filePath, `Draft workflow '${id}'`);
  }

  async saveDraft(draftId: string, definition: unknown): Promise<string> {
    const id = this.validateId(draftId, "draft_id");
    const filePath = this.resolveDraftPath(id);
    await mkdir(path.dirname(filePath), { recursive: true });
    const content = `${JSON.stringify(definition, null, 2)}\n`;
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  async savePublished(
    workflowId: string,
    definition: unknown,
    options?: { overwrite?: boolean },
  ): Promise<string> {
    const id = this.validateId(workflowId, "workflow_id");
    const filePath = this.resolvePublishedPath(id);
    await mkdir(path.dirname(filePath), { recursive: true });
    if (options?.overwrite !== true) {
      try {
        const s = await stat(filePath);
        if (s.isFile()) {
          throw new Error(`Published workflow '${id}' already exists.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("ENOENT")) {
          throw error;
        }
      }
    }
    const content = `${JSON.stringify(definition, null, 2)}\n`;
    await writeFile(filePath, content, "utf8");
    return filePath;
  }

  async listPublished(): Promise<Array<{ workflowId: string; path: string; updatedAt: string }>> {
    const rows = await this.listJsonFiles(path.join("workflows"), "workflow_id");
    return rows.map((row) => ({
      workflowId: row.id,
      path: row.path,
      updatedAt: row.updatedAt,
    }));
  }

  async listDrafts(): Promise<Array<{ draftId: string; path: string; updatedAt: string }>> {
    const rows = await this.listJsonFiles(path.join("workflows", "drafts"), "draft_id");
    return rows.map((row) => ({
      draftId: row.id,
      path: row.path,
      updatedAt: row.updatedAt,
    }));
  }

  resolvePublishedPath(workflowId: string): string {
    const id = this.validateId(workflowId, "workflow_id");
    return this.resolveWithinWorkspace(path.join("workflows", `${id}.json`));
  }

  resolveDraftPath(draftId: string): string {
    const id = this.validateId(draftId, "draft_id");
    return this.resolveWithinWorkspace(path.join("workflows", "drafts", `${id}.json`));
  }

  private validateId(value: string, label: string): string {
    const id = value.trim();
    if (!id) {
      throw new Error(`${label} cannot be empty.`);
    }
    if (!SAFE_ID.test(id)) {
      throw new Error(`${label} must match /^[A-Za-z0-9_-]+$/.`);
    }
    return id;
  }

  private resolveWithinWorkspace(relPath: string): string {
    const absolute = path.resolve(this.workspace, relPath);
    const rel = path.relative(this.workspace, absolute);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error("Access denied: workflow path escapes workspace.");
    }
    return absolute;
  }

  private async readJson(filePath: string, label: string): Promise<unknown> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        throw new Error(`${label} not found at ${filePath}`);
      }
      throw new Error(`Failed to read ${label}: ${message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} is not valid JSON: ${message}`);
    }

    if (!isObject(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }

    return parsed;
  }

  private async listJsonFiles(
    relDir: string,
    label: "workflow_id" | "draft_id",
  ): Promise<Array<{ id: string; path: string; updatedAt: string }>> {
    const dirPath = this.resolveWithinWorkspace(relDir);
    let names: string[];
    try {
      names = await readdir(dirPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return [];
      }
      throw new Error(`Failed to list ${label} files: ${message}`);
    }

    const out: Array<{ id: string; path: string; updatedAt: string }> = [];
    for (const name of names) {
      if (!name.endsWith(".json")) {
        continue;
      }
      const id = name.slice(0, -5);
      if (!SAFE_ID.test(id)) {
        continue;
      }
      const filePath = this.resolveWithinWorkspace(path.join(relDir, name));
      try {
        const s = await stat(filePath);
        if (!s.isFile()) {
          continue;
        }
        out.push({
          id,
          path: filePath,
          updatedAt: s.mtime.toISOString(),
        });
      } catch {
        // Skip unreadable entries.
      }
    }

    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return out;
  }
}
