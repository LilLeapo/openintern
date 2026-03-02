import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Tool, type ToolExecutionContext } from "../core/tool.js";

function resolvePath(
  input: string,
  workspace?: string,
  allowedDir?: string,
): string {
  const abs = path.isAbsolute(input) ? input : path.join(workspace ?? process.cwd(), input);
  const resolved = path.resolve(abs);
  if (allowedDir) {
    const root = path.resolve(allowedDir);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Path ${input} is outside allowed directory ${allowedDir}`);
    }
  }
  return resolved;
}

export class ReadFileTool extends Tool {
  readonly name = "read_file";
  readonly description = "Read the contents of a file at the given path.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to read" },
    },
    required: ["path"],
  } as const;

  constructor(
    private readonly workspace?: string,
    private readonly allowedDir?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>, _context?: ToolExecutionContext): Promise<string> {
    const rawPath = String(params.path ?? "");
    try {
      const filePath = resolvePath(rawPath, this.workspace, this.allowedDir);
      const s = await stat(filePath);
      if (!s.isFile()) {
        return `Error: Not a file: ${rawPath}`;
      }
      return await readFile(filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return `Error: File not found: ${rawPath}`;
      }
      return `Error reading file: ${message}`;
    }
  }
}

export class WriteFileTool extends Tool {
  readonly name = "write_file";
  readonly description = "Write content to a file. Creates parent directories if needed.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to write to" },
      content: { type: "string", description: "The content to write" },
    },
    required: ["path", "content"],
  } as const;

  constructor(
    private readonly workspace?: string,
    private readonly allowedDir?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const rawPath = String(params.path ?? "");
    const content = String(params.content ?? "");
    try {
      const filePath = resolvePath(rawPath, this.workspace, this.allowedDir);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
      return `Successfully wrote ${content.length} bytes to ${filePath}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error writing file: ${message}`;
    }
  }
}

export class EditFileTool extends Tool {
  readonly name = "edit_file";
  readonly description = "Edit a file by replacing old_text with new_text.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The file path to edit" },
      old_text: { type: "string", description: "Exact text to find" },
      new_text: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_text", "new_text"],
  } as const;

  constructor(
    private readonly workspace?: string,
    private readonly allowedDir?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const rawPath = String(params.path ?? "");
    const oldText = String(params.old_text ?? "");
    const newText = String(params.new_text ?? "");

    try {
      const filePath = resolvePath(rawPath, this.workspace, this.allowedDir);
      const content = await readFile(filePath, "utf8");
      if (!content.includes(oldText)) {
        return `Error: old_text not found in ${rawPath}. Verify the file content.`;
      }

      const count = content.split(oldText).length - 1;
      if (count > 1) {
        return `Warning: old_text appears ${count} times. Please provide more context to make it unique.`;
      }

      const next = content.replace(oldText, newText);
      await writeFile(filePath, next, "utf8");
      return `Successfully edited ${filePath}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return `Error: File not found: ${rawPath}`;
      }
      return `Error editing file: ${message}`;
    }
  }
}

export class ListDirTool extends Tool {
  readonly name = "list_dir";
  readonly description = "List the contents of a directory.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The directory path to list" },
    },
    required: ["path"],
  } as const;

  constructor(
    private readonly workspace?: string,
    private readonly allowedDir?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const rawPath = String(params.path ?? "");
    try {
      const dirPath = resolvePath(rawPath, this.workspace, this.allowedDir);
      const s = await stat(dirPath);
      if (!s.isDirectory()) {
        return `Error: Not a directory: ${rawPath}`;
      }

      const names = await readdir(dirPath);
      if (names.length === 0) {
        return `Directory ${rawPath} is empty`;
      }

      const rows = await Promise.all(
        names.sort().map(async (name) => {
          const entryPath = path.join(dirPath, name);
          const entryStat = await stat(entryPath);
          return `${entryStat.isDirectory() ? "[DIR]" : "[FILE]"} ${name}`;
        }),
      );
      return rows.join("\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return `Error: Directory not found: ${rawPath}`;
      }
      return `Error listing directory: ${message}`;
    }
  }
}

