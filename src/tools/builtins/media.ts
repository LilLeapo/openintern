import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { LLMProvider } from "../../llm/provider.js";
import { mimeFromExtension, resolvePath } from "./filesystem.js";
import { Tool } from "../core/tool.js";

const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const INSPECT_SAMPLE_BYTES = 4096;

function isImageMime(mime: string | null): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

async function readSample(filePath: string, maxBytes = INSPECT_SAMPLE_BYTES): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectBinarySample(bytes: Buffer): boolean {
  if (bytes.includes(0)) {
    return true;
  }
  let suspicious = 0;
  for (const byte of bytes) {
    const isControl = byte < 7 || (byte > 14 && byte < 32) || byte === 127;
    if (isControl) {
      suspicious += 1;
    }
  }
  return bytes.length > 0 && suspicious / bytes.length > 0.1;
}

function summarizeImagePrompt(prompt: string): string {
  const clean = prompt.trim();
  if (clean.length > 0) {
    return clean;
  }
  return "Describe the image and extract any relevant visible text.";
}

export class InspectFileTool extends Tool {
  readonly name = "inspect_file";
  readonly description = "Inspect a file or directory and recommend the right tool to use next.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The file or directory path to inspect" },
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
      const resolvedPath = resolvePath(rawPath, this.workspace, this.allowedDir);
      const fileStat = await stat(resolvedPath);
      const extension = path.extname(resolvedPath).toLowerCase();
      const mime = mimeFromExtension(extension);

      if (fileStat.isDirectory()) {
        return JSON.stringify({
          path: rawPath,
          resolvedPath,
          type: "directory",
          sizeBytes: fileStat.size,
          recommendedTool: "list_dir",
        });
      }

      if (!fileStat.isFile()) {
        return JSON.stringify({
          path: rawPath,
          resolvedPath,
          type: "other",
          sizeBytes: fileStat.size,
          recommendedTool: null,
        });
      }

      const sample = await readSample(resolvedPath);
      const isBinary = detectBinarySample(sample);
      const recommendedTool = isImageMime(mime)
        ? "read_image"
        : isBinary
          ? null
          : "read_file";

      return JSON.stringify({
        path: rawPath,
        resolvedPath,
        type: "file",
        sizeBytes: fileStat.size,
        extension,
        mime,
        isBinary,
        recommendedTool,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return `Error: File not found: ${rawPath}`;
      }
      return `Error inspecting file: ${message}`;
    }
  }
}

export class ReadImageTool extends Tool {
  readonly name = "read_image";
  readonly description = "Analyze an image file with the configured multimodal model.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "The image file path to analyze" },
      prompt: {
        type: "string",
        description: "Optional task or question about the image",
      },
    },
    required: ["path"],
  } as const;

  constructor(
    private readonly provider: LLMProvider,
    private readonly model: string,
    private readonly maxTokens: number,
    private readonly reasoningEffort: string | null,
    private readonly workspace?: string,
    private readonly allowedDir?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const rawPath = String(params.path ?? "");
    const prompt = summarizeImagePrompt(String(params.prompt ?? ""));
    try {
      const resolvedPath = resolvePath(rawPath, this.workspace, this.allowedDir);
      const fileStat = await stat(resolvedPath);
      if (!fileStat.isFile()) {
        return `Error: Not a file: ${rawPath}`;
      }

      const mime = mimeFromExtension(path.extname(resolvedPath));
      if (!isImageMime(mime)) {
        return `Error: Unsupported image type for read_image: ${rawPath}`;
      }
      if (fileStat.size > IMAGE_MAX_BYTES) {
        return `Error: Image too large for read_image: ${rawPath} (${fileStat.size} bytes, max ${IMAGE_MAX_BYTES})`;
      }

      const bytes = await readFile(resolvedPath);
      const b64 = bytes.toString("base64");
      const response = await this.provider.chat({
        model: this.model,
        maxTokens: Math.min(this.maxTokens, 1500),
        temperature: 0.1,
        reasoningEffort: this.reasoningEffort,
        messages: [
          {
            role: "system",
            content:
              "You analyze a single local image. Describe visible content accurately, and transcribe any relevant text that is readable. If the image is unclear, say so.",
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${mime};base64,${b64}`,
                },
              },
              {
                type: "text",
                text: prompt,
              },
            ],
          },
        ],
      });

      if (response.finishReason === "error") {
        return response.content ?? `Error: read_image failed for ${rawPath}`;
      }
      if (!response.content || response.content.trim().length === 0) {
        return `Error: read_image returned no content for ${rawPath}`;
      }
      return response.content.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ENOENT")) {
        return `Error: File not found: ${rawPath}`;
      }
      return `Error reading image: ${message}`;
    }
  }
}
