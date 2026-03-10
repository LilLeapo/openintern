import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Tool, type ToolExecutionContext } from "../core/tool.js";

export function resolvePath(
  input: string,
  workspace?: string,
  allowedDir?: string,
): string {
  const abs = path.isAbsolute(input) ? input : path.join(workspace ?? process.cwd(), input);
  const resolved = path.resolve(abs);
  if (allowedDir) {
    const root = path.resolve(allowedDir);
    const rel = path.relative(root, resolved);
    if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Access denied: path '${input}' escapes workspace sandbox`);
    }
  }
  return resolved;
}

export function detectBinary(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (sample.includes(0)) {
    return true;
  }

  let suspicious = 0;
  for (const byte of sample) {
    const isControl =
      byte < 7 || (byte > 14 && byte < 32) || byte === 127;
    if (isControl) {
      suspicious += 1;
    }
  }
  return sample.length > 0 && suspicious / sample.length > 0.1;
}

export function mimeFromExtension(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    default:
      return null;
  }
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
      const bytes = await readFile(filePath);
      if (detectBinary(bytes)) {
        const mime = mimeFromExtension(path.extname(filePath));
        const mimePart = mime ? ` (${mime})` : "";
        return `Error: File appears to be binary${mimePart}: ${rawPath}. Size=${bytes.length} bytes. Use an image/media-aware path instead of read_file.`;
      }
      return bytes.toString("utf8");
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
