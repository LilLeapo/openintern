import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrateConfig } from "./migrate.js";
import { DEFAULT_CONFIG, type AppConfig } from "./schema.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) {
    return (patch as T) ?? base;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    if (isObject(current) && isObject(value)) {
      result[key] = mergeDeep(current, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

export function getConfigPath(): string {
  return path.join(os.homedir(), ".openintern", "config.json");
}

export function getDataDir(): string {
  return path.join(os.homedir(), ".openintern");
}

export function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function resolveWorkspacePath(config: AppConfig): string {
  return path.resolve(expandHome(config.agents.defaults.workspace));
}

export async function loadConfig(configPath = getConfigPath()): Promise<AppConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const migrated = migrateConfig(parsed);
    return mergeDeep(DEFAULT_CONFIG, migrated);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export async function saveConfig(config: AppConfig, configPath = getConfigPath()): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export async function loadOrCreateConfig(configPath = getConfigPath()): Promise<AppConfig> {
  const config = await loadConfig(configPath);
  try {
    await readFile(configPath, "utf8");
  } catch {
    await saveConfig(config, configPath);
  }
  return config;
}
