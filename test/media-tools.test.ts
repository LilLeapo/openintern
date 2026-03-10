import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChatRequest, LLMProvider, LLMResponse } from "../src/llm/provider.js";
import { InspectFileTool, ReadImageTool } from "../src/tools/builtins/media.js";

class CapturingImageProvider implements LLMProvider {
  lastRequest: ChatRequest | null = null;

  getDefaultModel(): string {
    return "capture-image";
  }

  async chat(request: ChatRequest): Promise<LLMResponse> {
    this.lastRequest = request;
    return {
      content: "The image shows a simple test fixture.",
      toolCalls: [],
    };
  }
}

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "media-tools-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      rm(dir, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("media tools", () => {
  it("inspect_file recommends read_image for image files", async () => {
    const workspace = await makeWorkspace();
    const tool = new InspectFileTool(workspace, workspace);
    await writeFile(
      path.join(workspace, "sample.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    );

    const output = await tool.execute({
      path: "sample.png",
    });

    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.mime).toBe("image/png");
    expect(parsed.recommendedTool).toBe("read_image");
  });

  it("read_image sends multimodal content to the provider", async () => {
    const workspace = await makeWorkspace();
    const provider = new CapturingImageProvider();
    const tool = new ReadImageTool(provider, "vision-model", 2048, null, workspace, workspace);
    await writeFile(
      path.join(workspace, "sample.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    );

    const output = await tool.execute({
      path: "sample.png",
      prompt: "What is in this image?",
    });

    expect(output).toBe("The image shows a simple test fixture.");
    const content = provider.lastRequest?.messages[1]?.content;
    expect(Array.isArray(content)).toBe(true);
    const blocks = content as Array<Record<string, unknown>>;
    expect(blocks[0]?.type).toBe("image_url");
    expect(blocks[1]?.type).toBe("text");
  });
});
