import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildRuntimeCatalog } from "../src/ui/runtime-catalog.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "runtime-catalog-test-"));
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

describe("buildRuntimeCatalog", () => {
  it("returns roles/tools/skills with runtime status", async () => {
    const workspace = await makeWorkspace();
    const catalog = await buildRuntimeCatalog({
      workspace,
      config: structuredClone(DEFAULT_CONFIG),
      runtimeAvailable: true,
      runtimeInitError: null,
    });

    expect(catalog.runtimeAvailable).toBe(true);
    expect(catalog.runtimeInitError).toBeNull();
    expect(catalog.roles.length).toBeGreaterThan(0);
    expect(catalog.tools.some((tool) => tool.id === "trigger_workflow")).toBe(true);
    expect(Array.isArray(catalog.skills)).toBe(true);
  });

  it("includes external MCP tools in catalog", async () => {
    const workspace = await makeWorkspace();
    const catalog = await buildRuntimeCatalog({
      workspace,
      config: structuredClone(DEFAULT_CONFIG),
      runtimeAvailable: true,
      runtimeInitError: null,
      extraToolIds: ["lark-mcp__wiki_get_node", "lark-mcp__docx_builtin_import"],
    });

    const mcpTool = catalog.tools.find((tool) => tool.id === "lark-mcp__wiki_get_node");
    expect(mcpTool?.source).toBe("mcp");
    expect(mcpTool?.description).toContain("MCP");
  });
});
