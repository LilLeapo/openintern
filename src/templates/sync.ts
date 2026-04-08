import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MemoryMode } from "../config/schema.js";
import { WORKSPACE_TEMPLATES } from "./defaults.js";

const WIKI_ONLY_PREFIXES = ["WIKI_SCHEMA.md", "wiki/", "raw/"];

export async function syncWorkspaceTemplates(
  workspace: string,
  memoryMode: MemoryMode = "wiki",
): Promise<void> {
  await mkdir(workspace, { recursive: true });

  for (const [relPath, content] of Object.entries(WORKSPACE_TEMPLATES)) {
    if (memoryMode !== "wiki" && WIKI_ONLY_PREFIXES.some((p) => relPath.startsWith(p))) {
      continue;
    }
    const fullPath = path.join(workspace, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    try {
      await readFile(fullPath, "utf8");
    } catch {
      await writeFile(fullPath, content, "utf8");
    }
  }
}

