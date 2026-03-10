import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { AppConfig, RoleConfig } from "./schema.js";

function expandHome(input: string): string {
  if (input === "~") {
    return os.homedir();
  }
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function normalizeAllowedTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const name = item.trim();
    if (!name) {
      continue;
    }
    deduped.add(name);
  }
  return Array.from(deduped);
}

function normalizeMaxIterations(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 15;
  }
  return Math.floor(num);
}

export function normalizeRoleConfig(raw: Partial<RoleConfig> | Record<string, unknown>): RoleConfig | null {
  const systemPrompt = typeof raw.systemPrompt === "string" ? raw.systemPrompt.trim() : "";
  const allowedTools = normalizeAllowedTools(raw.allowedTools);
  const memoryScope = raw.memoryScope;

  if (!systemPrompt) {
    return null;
  }
  if (allowedTools.length === 0) {
    return null;
  }
  if (memoryScope !== "chat" && memoryScope !== "papers") {
    return null;
  }

  return {
    systemPrompt,
    allowedTools,
    memoryScope,
    maxIterations: normalizeMaxIterations(raw.maxIterations),
    workspaceIsolation: raw.workspaceIsolation === true,
  };
}

function roleRoots(config: AppConfig): string[] {
  const workspace = path.resolve(expandHome(config.agents.defaults.workspace));
  return [
    path.join(os.homedir(), ".openintern", "roles"),
    path.join(workspace, "roles"),
  ];
}

function readRoleDirectory(dirPath: string): RoleConfig | null {
  const roleJsonPath = path.join(dirPath, "role.json");
  const systemPath = path.join(dirPath, "SYSTEM.md");
  if (!existsSync(roleJsonPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(readFileSync(roleJsonPath, "utf8")) as Record<string, unknown>;
    const systemPromptFromFile = existsSync(systemPath)
      ? readFileSync(systemPath, "utf8").trim()
      : "";
    const merged: Record<string, unknown> = {
      ...raw,
      systemPrompt:
        systemPromptFromFile ||
        (typeof raw.systemPrompt === "string" ? raw.systemPrompt : ""),
    };
    return normalizeRoleConfig(merged);
  } catch {
    return null;
  }
}

function externalRoles(config: AppConfig): Map<string, RoleConfig> {
  const out = new Map<string, RoleConfig>();
  for (const root of roleRoots(config)) {
    if (!existsSync(root)) {
      continue;
    }
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = readdirSync(root, { withFileTypes: true }) as Array<{
        name: string;
        isDirectory(): boolean;
      }>;
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const name = entry.name.trim();
      if (!name) {
        continue;
      }
      const resolved = readRoleDirectory(path.join(root, name));
      if (resolved) {
        out.set(name, resolved);
      }
    }
  }
  return out;
}

export function listResolvedRoles(config: AppConfig): Array<{ name: string; role: RoleConfig }> {
  const merged = new Map<string, RoleConfig>();
  for (const [name, raw] of Object.entries(config.roles)) {
    const normalized = normalizeRoleConfig(raw);
    if (normalized) {
      merged.set(name, normalized);
    }
  }
  for (const [name, role] of externalRoles(config)) {
    merged.set(name, role);
  }
  return Array.from(merged.entries())
    .map(([name, role]) => ({ name, role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveRole(config: AppConfig, roleName: string): RoleConfig | null {
  const name = roleName.trim();
  if (!name) {
    return null;
  }
  const external = externalRoles(config).get(name);
  if (external) {
    return external;
  }
  const raw = config.roles[name];
  if (!raw) {
    return null;
  }
  return normalizeRoleConfig(raw);
}

export function validateRoleName(config: AppConfig, roleName: string): string | null {
  const name = roleName.trim();
  if (!name) {
    return "Error: role must be a non-empty string.";
  }

  if (!resolveRole(config, name)) {
    const available = listResolvedRoles(config).map((item) => item.name);
    const suffix = available.length > 0 ? ` Available roles: ${available.join(", ")}.` : "";
    return `Error: Unknown role '${name}'.${suffix}`;
  }

  return null;
}
