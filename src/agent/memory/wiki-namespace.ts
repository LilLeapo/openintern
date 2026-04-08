import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import type { WikiNamespaceConfig } from "../../config/schema.js";

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
}

export interface WikiNamespaceContext {
  principalId?: string;
  department?: string;
}

export interface ResolvedWikiNamespaces {
  /** The primary namespace for this context (where writes go by default) */
  active: string;
  /** All readable namespaces (always includes @shared if enabled) */
  readable: string[];
  /** Filesystem paths for each namespace */
  paths: Record<string, string>;
}

export class WikiNamespaceResolver {
  constructor(
    private readonly wikiRoot: string,
    private readonly config: WikiNamespaceConfig,
  ) {}

  resolve(context: WikiNamespaceContext): ResolvedWikiNamespaces {
    const readable: string[] = [];
    const paths: Record<string, string> = {};

    // @shared is always readable if enabled
    if (this.config.shared) {
      const ns = "@shared";
      readable.push(ns);
      paths[ns] = path.join(this.wikiRoot, ns);
    }

    // Personal namespace
    let personalNs: string | null = null;
    if (this.config.personal && context.principalId) {
      personalNs = `@user-${sanitize(context.principalId)}`;
      readable.push(personalNs);
      paths[personalNs] = path.join(this.wikiRoot, personalNs);
    }

    // Department namespace
    let deptNs: string | null = null;
    if (this.config.departmentKey && context.department) {
      deptNs = `@dept-${sanitize(context.department)}`;
      readable.push(deptNs);
      paths[deptNs] = path.join(this.wikiRoot, deptNs);
    }

    // Determine active namespace
    let active: string;
    if (this.config.defaultNamespace === "personal" && personalNs) {
      active = personalNs;
    } else if (this.config.shared) {
      active = "@shared";
    } else if (personalNs) {
      active = personalNs;
    } else {
      active = "@shared";
      readable.push("@shared");
      paths["@shared"] = path.join(this.wikiRoot, "@shared");
    }

    return { active, readable, paths };
  }

  /**
   * Ensure a namespace directory exists with the standard subdirectories.
   */
  async ensureNamespace(namespacePath: string): Promise<void> {
    const subdirs = ["sources", "entities", "concepts", "analyses"];
    for (const sub of subdirs) {
      await mkdir(path.join(namespacePath, sub), { recursive: true });
    }
  }

  /**
   * List all existing namespaces in the wiki directory.
   */
  async listNamespaces(): Promise<string[]> {
    try {
      const entries = await readdir(this.wikiRoot);
      return entries.filter((e) => e.startsWith("@"));
    } catch {
      return [];
    }
  }
}
