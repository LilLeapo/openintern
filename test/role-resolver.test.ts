import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listResolvedRoles, resolveRole, validateRoleName } from "../src/config/role-resolver.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "role-resolver-test-"));
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

describe("role resolver", () => {
  it("loads roles from workspace role directories and prefers them over inline config", async () => {
    const workspace = await makeWorkspace();
    const roleDir = path.join(workspace, "roles", "researcher");
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      path.join(roleDir, "role.json"),
      JSON.stringify({
        allowedTools: ["inspect_file", "read_image"],
        memoryScope: "papers",
        maxIterations: 7,
        workspaceIsolation: false,
      }),
      "utf8",
    );
    await writeFile(
      path.join(roleDir, "SYSTEM.md"),
      "Workspace researcher prompt.",
      "utf8",
    );

    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.defaults.workspace = workspace;
    config.roles.researcher.systemPrompt = "Inline prompt";

    const role = resolveRole(config, "researcher");
    expect(role?.systemPrompt).toBe("Workspace researcher prompt.");
    expect(role?.allowedTools).toEqual(["inspect_file", "read_image"]);

    const roles = listResolvedRoles(config).map((item) => item.name);
    expect(roles).toContain("researcher");
    expect(validateRoleName(config, "researcher")).toBeNull();
  });

  it("includes external roles in validation errors", async () => {
    const workspace = await makeWorkspace();
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.defaults.workspace = workspace;

    const error = validateRoleName(config, "missing-role");
    expect(error).toContain("Available roles:");
    expect(error).toContain("researcher");
    expect(error).toContain("scientist");
  });
});
