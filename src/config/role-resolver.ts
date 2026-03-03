import type { AppConfig, RoleConfig } from "./schema.js";

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

function normalizeRoleConfig(raw: RoleConfig): RoleConfig | null {
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

export function resolveRole(config: AppConfig, roleName: string): RoleConfig | null {
  const name = roleName.trim();
  if (!name) {
    return null;
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

  const raw = config.roles[name];
  if (!raw) {
    const available = Object.keys(config.roles).sort();
    const suffix = available.length > 0 ? ` Available roles: ${available.join(", ")}.` : "";
    return `Error: Unknown role '${name}'.${suffix}`;
  }

  if (!normalizeRoleConfig(raw)) {
    return `Error: Role '${name}' is invalid in config. Check systemPrompt, allowedTools, and memoryScope.`;
  }

  return null;
}
