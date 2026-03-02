import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { WORKSPACE_TEMPLATES } from "./defaults.js";

export async function syncWorkspaceTemplates(workspace: string): Promise<void> {
  await mkdir(workspace, { recursive: true });

  for (const [relPath, content] of Object.entries(WORKSPACE_TEMPLATES)) {
    const fullPath = path.join(workspace, relPath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    try {
      await readFile(fullPath, "utf8");
    } catch {
      await writeFile(fullPath, content, "utf8");
    }
  }
}

