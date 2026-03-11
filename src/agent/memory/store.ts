import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export class MemoryStore {
  readonly memoryDir: string;
  readonly memoryFile: string;
  readonly historyFile: string;

  constructor(workspace: string, namespace?: string) {
    const memoryRoot = path.join(workspace, "memory");
    this.memoryDir = namespace
      ? path.join(
          memoryRoot,
          ...namespace.split("/").map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, "_")),
        )
      : memoryRoot;
    this.memoryFile = path.join(this.memoryDir, "MEMORY.md");
    this.historyFile = path.join(this.memoryDir, "HISTORY.md");
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
  }

  async readLongTerm(): Promise<string> {
    try {
      return await readFile(this.memoryFile, "utf8");
    } catch {
      return "";
    }
  }

  async writeLongTerm(content: string): Promise<void> {
    await this.ensureDir();
    await writeFile(this.memoryFile, content, "utf8");
  }

  async appendHistory(entry: string): Promise<void> {
    await this.ensureDir();
    await appendFile(this.historyFile, `${entry.trimEnd()}\n\n`, "utf8");
  }

  async getMemoryContext(): Promise<string> {
    const longTerm = await this.readLongTerm();
    return longTerm ? `## Long-term Memory\n${longTerm}` : "";
  }
}
