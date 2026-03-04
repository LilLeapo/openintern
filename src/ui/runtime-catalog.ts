import { SkillsLoader } from "../agent/skills/loader.js";
import type { AppConfig } from "../config/schema.js";

export interface RuntimeCatalogTool {
  id: string;
  name: string;
  description: string;
  riskLevel: "low" | "high";
  source: "builtin";
}

export interface RuntimeCatalogRole {
  id: string;
  systemPrompt: string;
  allowedTools: string[];
}

export interface RuntimeCatalogSkill {
  name: string;
  path: string;
  source: "workspace" | "builtin";
  available: boolean;
  description: string;
  requires: string[];
}

export interface RuntimeCatalog {
  runtimeAvailable: boolean;
  runtimeInitError: string | null;
  roles: RuntimeCatalogRole[];
  tools: RuntimeCatalogTool[];
  skills: RuntimeCatalogSkill[];
}

const HIGH_RISK_KEYWORDS = ["exec", "overwrite", "delete", "control", "rm", "kill"];

function inferRisk(toolId: string): "low" | "high" {
  const normalized = toolId.toLowerCase();
  if (HIGH_RISK_KEYWORDS.some((item) => normalized.includes(item))) {
    return "high";
  }
  return "low";
}

function roleCatalog(config: AppConfig): RuntimeCatalogRole[] {
  return Object.entries(config.roles)
    .map(([id, role]) => ({
      id,
      systemPrompt: role.systemPrompt,
      allowedTools: Array.from(new Set(role.allowedTools)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toolCatalog(config: AppConfig): RuntimeCatalogTool[] {
  const union = new Set<string>();
  for (const role of Object.values(config.roles)) {
    for (const toolId of role.allowedTools) {
      union.add(toolId);
    }
  }

  const runtimeBuiltins = [
    "message",
    "spawn",
    "cron",
    "trigger_workflow",
    "query_workflow_status",
    "draft_workflow",
  ];
  for (const toolId of runtimeBuiltins) {
    union.add(toolId);
  }

  return Array.from(union)
    .sort((a, b) => a.localeCompare(b))
    .map((toolId) => ({
      id: toolId,
      name: toolId,
      description: "Runtime built-in tool",
      source: "builtin" as const,
      riskLevel: inferRisk(toolId),
    }));
}

export async function buildRuntimeCatalog(options: {
  workspace: string;
  config: AppConfig;
  runtimeAvailable: boolean;
  runtimeInitError: string | null;
}): Promise<RuntimeCatalog> {
  const roles = roleCatalog(options.config);
  const tools = toolCatalog(options.config);
  const skillsLoader = new SkillsLoader(options.workspace);
  const skills = await skillsLoader.listSkillsCatalog();

  return {
    runtimeAvailable: options.runtimeAvailable,
    runtimeInitError: options.runtimeInitError,
    roles,
    tools,
    skills,
  };
}
