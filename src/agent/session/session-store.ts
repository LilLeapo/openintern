import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface SessionMessage {
  role: string;
  content?: unknown;
  timestamp?: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
}

export class Session {
  key: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;
  lastConsolidated: number;

  constructor(key: string, options?: Partial<Session>) {
    this.key = key;
    this.messages = options?.messages ? [...options.messages] : [];
    this.createdAt = options?.createdAt ?? new Date();
    this.updatedAt = options?.updatedAt ?? new Date();
    this.metadata = { ...(options?.metadata ?? {}) };
    this.lastConsolidated = options?.lastConsolidated ?? 0;
  }

  getHistory(maxMessages = 500): SessionMessage[] {
    const unconsolidated = this.messages.slice(this.lastConsolidated);
    let sliced = unconsolidated.slice(-maxMessages);

    const firstUserIndex = sliced.findIndex((m) => m.role === "user");
    if (firstUserIndex > 0) {
      sliced = sliced.slice(firstUserIndex);
    }

    return sliced.map((m) => {
      const out: SessionMessage = {
        role: m.role,
        content: m.content ?? "",
      };
      for (const key of ["tool_calls", "tool_call_id", "name"] as const) {
        if (m[key] !== undefined) {
          (out as Record<string, unknown>)[key] = m[key];
        }
      }
      return out;
    });
  }

  clear(): void {
    this.messages = [];
    this.lastConsolidated = 0;
    this.updatedAt = new Date();
  }
}

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly cache = new Map<string, Session>();
  private readonly initPromise: Promise<void>;

  constructor(private readonly workspace: string) {
    this.sessionsDir = path.join(workspace, "sessions");
    this.initPromise = mkdir(this.sessionsDir, { recursive: true }).then(() => undefined);
  }

  private sessionPath(key: string): string {
    const safe = safeFilename(key.replace(":", "_"));
    return path.join(this.sessionsDir, `${safe}.jsonl`);
  }

  async getOrCreate(key: string): Promise<Session> {
    await this.initPromise;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const loaded = await this.load(key);
    const session = loaded ?? new Session(key);
    this.cache.set(key, session);
    return session;
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  async save(session: Session): Promise<void> {
    await this.initPromise;
    const metadataLine = JSON.stringify({
      _type: "metadata",
      key: session.key,
      created_at: session.createdAt.toISOString(),
      updated_at: session.updatedAt.toISOString(),
      metadata: session.metadata,
      last_consolidated: session.lastConsolidated,
    });

    const lines = [metadataLine, ...session.messages.map((m) => JSON.stringify(m))];
    await writeFile(this.sessionPath(session.key), `${lines.join("\n")}\n`, "utf8");
    this.cache.set(session.key, session);
  }

  private async load(key: string): Promise<Session | null> {
    try {
      const raw = await readFile(this.sessionPath(key), "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        return null;
      }

      let createdAt: Date | undefined;
      let lastConsolidated = 0;
      let metadata: Record<string, unknown> = {};
      const messages: SessionMessage[] = [];

      for (const line of lines) {
        const data = JSON.parse(line) as Record<string, unknown>;
        if (data._type === "metadata") {
          createdAt = typeof data.created_at === "string" ? new Date(data.created_at) : undefined;
          lastConsolidated =
            typeof data.last_consolidated === "number" ? data.last_consolidated : 0;
          metadata =
            typeof data.metadata === "object" && data.metadata !== null
              ? (data.metadata as Record<string, unknown>)
              : {};
          continue;
        }
        messages.push(data as SessionMessage);
      }

      return new Session(key, {
        messages,
        createdAt,
        metadata,
        lastConsolidated,
      });
    } catch {
      return null;
    }
  }
}
