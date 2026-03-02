import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillsLoader } from "../src/agent/skills/loader.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
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

describe("skills loader", () => {
  it("prefers workspace skill over builtin skill", async () => {
    const workspace = await makeTempDir("skills-workspace-");
    const builtin = await makeTempDir("skills-builtin-");

    await mkdir(path.join(workspace, "skills", "git"), { recursive: true });
    await mkdir(path.join(builtin, "git"), { recursive: true });
    await writeFile(
      path.join(workspace, "skills", "git", "SKILL.md"),
      "# Workspace git skill",
      "utf8",
    );
    await writeFile(path.join(builtin, "git", "SKILL.md"), "# Builtin git skill", "utf8");

    const loader = new SkillsLoader(workspace, builtin);
    const content = await loader.loadSkill("git");
    expect(content).toContain("Workspace git skill");
  });

  it("builds skills summary with availability", async () => {
    const workspace = await makeTempDir("skills-summary-");
    const builtin = await makeTempDir("skills-builtin-summary-");

    await mkdir(path.join(builtin, "weather"), { recursive: true });
    await writeFile(
      path.join(builtin, "weather", "SKILL.md"),
      `---
description: Weather skill
metadata: '{"nanobot":{"requires":{"env":["MISSING_ENV_XYZ"]}}}'
---
# Weather`,
      "utf8",
    );

    const loader = new SkillsLoader(workspace, builtin);
    const summary = await loader.buildSkillsSummary();
    expect(summary).toContain(`<name>weather</name>`);
    expect(summary).toContain(`available="false"`);
    expect(summary).toContain("MISSING_ENV_XYZ");
  });
});

