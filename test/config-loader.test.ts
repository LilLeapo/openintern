import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  expandHome,
  loadConfig,
  loadOrCreateConfig,
  resolveWorkspacePath,
} from "../src/config/loader.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "config-loader-test-"));
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

describe("config loader", () => {
  it("loads defaults when config file does not exist", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "config.json");
    const config = await loadConfig(file);
    expect(config.agents.defaults.model).toBe("gpt-4o-mini");
    expect(config.agents.defaults.provider).toBe("auto");
    expect(config.providers.openaiCompatible.apiBase).toBe("https://api.openai.com/v1");
    expect(config.providers.anthropicCompatible.apiBase).toBe("https://api.anthropic.com/v1");
    expect(config.memory.memu.enabled).toBe(false);
    expect(config.memory.memu.baseUrl).toBe("https://api.memu.so");
  });

  it("migrates old key names", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        providers: {
          openai_compatible: {
            api_key: "k1",
            api_base: "http://localhost:1234/v1",
          },
          anthropic_compatible: {
            api_key: "ak1",
            api_base: "http://localhost:5000/v1",
            anthropic_version: "2023-06-01",
          },
        },
        tools: {
          web: {
            search: {
              api_key: "brave1",
              max_results: 3,
            },
          },
        },
        memory: {
          memu: {
            api_key: "memu-key",
            base_url: "https://api.memu.so",
            agent_id: "agent-1",
            timeout_ms: 9999,
            retrieve_enabled: false,
            memorize_enabled: false,
          },
        },
      }),
      "utf8",
    );
    const config = await loadConfig(file);
    expect(config.providers.openaiCompatible.apiKey).toBe("k1");
    expect(config.providers.openaiCompatible.apiBase).toBe("http://localhost:1234/v1");
    expect(config.providers.anthropicCompatible.apiKey).toBe("ak1");
    expect(config.providers.anthropicCompatible.apiBase).toBe("http://localhost:5000/v1");
    expect(config.providers.anthropicCompatible.anthropicVersion).toBe("2023-06-01");
    expect(config.tools.web.search.apiKey).toBe("brave1");
    expect(config.tools.web.search.maxResults).toBe(3);
    expect(config.memory.memu.apiKey).toBe("memu-key");
    expect(config.memory.memu.baseUrl).toBe("https://api.memu.so");
    expect(config.memory.memu.agentId).toBe("agent-1");
    expect(config.memory.memu.timeoutMs).toBe(9999);
    expect(config.memory.memu.retrieve).toBe(false);
    expect(config.memory.memu.memorize).toBe(false);
  });

  it("creates config when missing", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "config.json");
    const config = await loadOrCreateConfig(file);
    expect(config.channels.sendProgress).toBe(true);
    const raw = await readFile(file, "utf8");
    expect(raw).toContain('"openaiCompatible"');
  });

  it("expands and resolves workspace path", async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        agents: {
          defaults: {
            workspace: "~/my-openintern-ws",
          },
        },
      }),
      "utf8",
    );
    const config = await loadConfig(file);
    expect(expandHome(config.agents.defaults.workspace).includes(os.homedir())).toBe(true);
    expect(path.isAbsolute(resolveWorkspacePath(config))).toBe(true);
  });
});
