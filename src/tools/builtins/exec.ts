import { spawn } from "node:child_process";
import path from "node:path";

import { Tool, type ToolExecutionContext } from "../core/tool.js";

export interface ExecToolOptions {
  timeoutMs?: number;
  workingDir?: string;
  denyPatterns?: RegExp[];
  allowPatterns?: RegExp[];
  restrictToWorkspace?: boolean;
}

const DEFAULT_DENY_PATTERNS = [
  /\brm\s+-[rf]{1,2}\b/i,
  /\bdel\s+\/[fq]\b/i,
  /\brmdir\s+\/s\b/i,
  /(?:^|[;&|]\s*)format\b/i,
  /\b(mkfs|diskpart)\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/sd/i,
  /\b(shutdown|reboot|poweroff)\b/i,
  /:\(\)\s*\{.*\};\s*:/i,
];

export class ExecTool extends Tool {
  readonly name = "exec";
  readonly description = "Execute a shell command and return its output.";
  readonly parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "The shell command to execute" },
      working_dir: { type: "string", description: "Optional working directory for command" },
    },
    required: ["command"],
  } as const;

  private readonly timeoutMs: number;
  private readonly baseWorkingDir: string;
  private readonly denyPatterns: RegExp[];
  private readonly allowPatterns: RegExp[];
  private readonly restrictToWorkspace: boolean;

  constructor(options?: ExecToolOptions) {
    super();
    this.timeoutMs = options?.timeoutMs ?? 60_000;
    this.baseWorkingDir = path.resolve(options?.workingDir ?? process.cwd());
    this.denyPatterns = options?.denyPatterns ?? DEFAULT_DENY_PATTERNS;
    this.allowPatterns = options?.allowPatterns ?? [];
    this.restrictToWorkspace = options?.restrictToWorkspace ?? false;
  }

  async execute(
    params: Record<string, unknown>,
    context?: ToolExecutionContext,
  ): Promise<string> {
    const command = String(params.command ?? "");
    const rawWorkingDir =
      typeof params.working_dir === "string" ? params.working_dir : this.baseWorkingDir;
    const workingDir = path.resolve(rawWorkingDir);

    const guardError = this.guardCommand(command, workingDir);
    if (guardError) {
      return guardError;
    }

    return new Promise<string>((resolve) => {
      const child = spawn(command, {
        shell: true,
        cwd: workingDir,
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let done = false;

      const finish = (value: string) => {
        if (done) {
          return;
        }
        done = true;
        resolve(value);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(`Error: Command timed out after ${Math.round(this.timeoutMs / 1000)} seconds`);
      }, this.timeoutMs);

      context?.signal?.addEventListener(
        "abort",
        () => {
          child.kill("SIGKILL");
          clearTimeout(timer);
          finish("Error: Command aborted");
        },
        { once: true },
      );

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        finish(`Error executing command: ${error.message}`);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const parts: string[] = [];
        if (stdout.trim()) {
          parts.push(stdout);
        }
        if (stderr.trim()) {
          parts.push(`STDERR:\n${stderr}`);
        }
        if (code !== 0) {
          parts.push(`\nExit code: ${code}`);
        }
        const out = parts.length > 0 ? parts.join("\n") : "(no output)";
        const maxLen = 10_000;
        if (out.length > maxLen) {
          finish(`${out.slice(0, maxLen)}\n... (truncated, ${out.length - maxLen} more chars)`);
          return;
        }
        finish(out);
      });
    });
  }

  private guardCommand(command: string, cwd: string): string | null {
    for (const pattern of this.denyPatterns) {
      if (pattern.test(command)) {
        return "Error: Command blocked by safety guard (dangerous pattern detected)";
      }
    }
    if (this.allowPatterns.length > 0 && !this.allowPatterns.some((p) => p.test(command))) {
      return "Error: Command blocked by safety guard (not in allowlist)";
    }

    if (this.restrictToWorkspace) {
      if (command.includes("../") || command.includes("..\\")) {
        return "Error: Command blocked by safety guard (path traversal detected)";
      }

      const root = this.baseWorkingDir;
      if (cwd !== root && !cwd.startsWith(`${root}${path.sep}`)) {
        return "Error: Command blocked by safety guard (path outside working dir)";
      }
    }

    return null;
  }
}

