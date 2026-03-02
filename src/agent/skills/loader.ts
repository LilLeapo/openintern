import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SkillInfo {
  name: string;
  path: string;
  source: "workspace" | "builtin";
}

interface SkillMetadata {
  description?: string;
  metadata?: string;
  always?: boolean;
}

interface ParsedSkillMeta {
  requires?: {
    bins?: string[];
    env?: string[];
  };
  always?: boolean;
}

async function existsDir(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(dirPath);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

function parseFrontmatter(content: string): SkillMetadata | null {
  if (!content.startsWith("---\n")) {
    return null;
  }
  const end = content.indexOf("\n---\n");
  if (end <= 0) {
    return null;
  }
  const block = content.slice(4, end);
  const metadata: SkillMetadata = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "description") {
      metadata.description = value;
    } else if (key === "metadata") {
      metadata.metadata = value;
    } else if (key === "always") {
      metadata.always = value === "true";
    }
  }
  return metadata;
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---\n")) {
    return content;
  }
  const end = content.indexOf("\n---\n");
  if (end <= 0) {
    return content;
  }
  return content.slice(end + 5).trim();
}

function parseSkillMeta(metadata: string | undefined): ParsedSkillMeta {
  if (!metadata) {
    return {};
  }
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    if (parsed.nanobot && typeof parsed.nanobot === "object") {
      return parsed.nanobot as ParsedSkillMeta;
    }
    if (parsed.openclaw && typeof parsed.openclaw === "object") {
      return parsed.openclaw as ParsedSkillMeta;
    }
    return parsed as ParsedSkillMeta;
  } catch {
    return {};
  }
}

function missingRequirements(meta: ParsedSkillMeta): string[] {
  const missing: string[] = [];
  for (const bin of meta.requires?.bins ?? []) {
    const resolver = (process as unknown as {
      which?: (cmd: string) => string | undefined;
    }).which;
    if (resolver) {
      if (!resolver(bin)) {
        missing.push(`CLI: ${bin}`);
      }
      continue;
    }

    const hasBin = (process.env.PATH ?? "")
      .split(path.delimiter)
      .some((entry) => {
        if (!entry) {
          return false;
        }
        const full = path.join(entry, bin);
        return existsSync(full);
      });
    if (!hasBin) {
      missing.push(`CLI: ${bin}`);
    }
  }

  for (const envName of meta.requires?.env ?? []) {
    if (!process.env[envName]) {
      missing.push(`ENV: ${envName}`);
    }
  }
  return missing;
}

async function findSkillFile(baseDir: string, skillName: string): Promise<string | null> {
  const skillPath = path.join(baseDir, skillName, "SKILL.md");
  return (await existsFile(skillPath)) ? skillPath : null;
}

export class SkillsLoader {
  private readonly workspaceSkills: string;
  private readonly builtinSkills: string;

  constructor(
    private readonly workspace: string,
    builtinSkillsDir?: string,
  ) {
    this.workspaceSkills = path.join(workspace, "skills");
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    this.builtinSkills =
      builtinSkillsDir ?? path.resolve(thisDir, "../../skills");
  }

  async listSkills(filterUnavailable = true): Promise<SkillInfo[]> {
    const out: SkillInfo[] = [];

    if (await existsDir(this.workspaceSkills)) {
      const entries = await readdir(this.workspaceSkills);
      for (const name of entries) {
        const skillFile = await findSkillFile(this.workspaceSkills, name);
        if (skillFile) {
          out.push({ name, path: skillFile, source: "workspace" });
        }
      }
    }

    if (await existsDir(this.builtinSkills)) {
      const entries = await readdir(this.builtinSkills);
      for (const name of entries) {
        if (out.some((skill) => skill.name === name)) {
          continue;
        }
        const skillFile = await findSkillFile(this.builtinSkills, name);
        if (skillFile) {
          out.push({ name, path: skillFile, source: "builtin" });
        }
      }
    }

    if (!filterUnavailable) {
      return out;
    }
    const filtered: SkillInfo[] = [];
    for (const skill of out) {
      const metadata = await this.getSkillMetadata(skill.name);
      const parsed = parseSkillMeta(metadata?.metadata);
      if (missingRequirements(parsed).length === 0) {
        filtered.push(skill);
      }
    }
    return filtered;
  }

  async loadSkill(name: string): Promise<string | null> {
    const workspacePath = path.join(this.workspaceSkills, name, "SKILL.md");
    if (await existsFile(workspacePath)) {
      return readFile(workspacePath, "utf8");
    }
    const builtinPath = path.join(this.builtinSkills, name, "SKILL.md");
    if (await existsFile(builtinPath)) {
      return readFile(builtinPath, "utf8");
    }
    return null;
  }

  async loadSkillsForContext(skillNames: string[]): Promise<string> {
    const parts: string[] = [];
    for (const name of skillNames) {
      const content = await this.loadSkill(name);
      if (!content) {
        continue;
      }
      parts.push(`### Skill: ${name}\n\n${stripFrontmatter(content)}`);
    }
    return parts.join("\n\n---\n\n");
  }

  async getSkillMetadata(name: string): Promise<SkillMetadata | null> {
    const content = await this.loadSkill(name);
    if (!content) {
      return null;
    }
    return parseFrontmatter(content);
  }

  async getAlwaysSkills(): Promise<string[]> {
    const skills = await this.listSkills(false);
    const out: string[] = [];
    for (const skill of skills) {
      const metadata = await this.getSkillMetadata(skill.name);
      const parsed = parseSkillMeta(metadata?.metadata);
      const always = metadata?.always || parsed.always;
      if (!always) {
        continue;
      }
      if (missingRequirements(parsed).length > 0) {
        continue;
      }
      out.push(skill.name);
    }
    return out;
  }

  async buildSkillsSummary(): Promise<string> {
    const skills = await this.listSkills(false);
    if (skills.length === 0) {
      return "";
    }

    const xmlEscape = (input: string) =>
      input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

    const lines = ["<skills>"];
    for (const skill of skills) {
      const metadata = await this.getSkillMetadata(skill.name);
      const parsed = parseSkillMeta(metadata?.metadata);
      const missing = missingRequirements(parsed);
      const available = missing.length === 0;
      lines.push(`  <skill available="${available ? "true" : "false"}">`);
      lines.push(`    <name>${xmlEscape(skill.name)}</name>`);
      lines.push(
        `    <description>${xmlEscape(metadata?.description ?? skill.name)}</description>`,
      );
      lines.push(`    <location>${xmlEscape(skill.path)}</location>`);
      if (!available) {
        lines.push(`    <requires>${xmlEscape(missing.join(", "))}</requires>`);
      }
      lines.push("  </skill>");
    }
    lines.push("</skills>");
    return lines.join("\n");
  }
}
