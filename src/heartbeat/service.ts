import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LLMProvider } from "../llm/provider.js";

const HEARTBEAT_TOOL = [
  {
    type: "function",
    function: {
      name: "heartbeat",
      description: "Report heartbeat decision after reviewing tasks.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["skip", "run"],
            description: "skip = nothing to do, run = has active tasks",
          },
          tasks: {
            type: "string",
            description: "Natural-language summary of active tasks (required for run)",
          },
        },
        required: ["action"],
      },
    },
  },
] as const;

export interface HeartbeatServiceOptions {
  workspace: string;
  provider: LLMProvider;
  model: string;
  onExecute?: (tasks: string) => Promise<string>;
  onNotify?: (response: string) => Promise<void>;
  intervalS?: number;
  enabled?: boolean;
}

export class HeartbeatService {
  private readonly workspace: string;
  private readonly provider: LLMProvider;
  private readonly model: string;
  private readonly onExecute?: (tasks: string) => Promise<string>;
  private readonly onNotify?: (response: string) => Promise<void>;
  private readonly intervalS: number;
  private readonly enabled: boolean;

  private running = false;
  private task: Promise<void> | null = null;

  constructor(options: HeartbeatServiceOptions) {
    this.workspace = options.workspace;
    this.provider = options.provider;
    this.model = options.model;
    this.onExecute = options.onExecute;
    this.onNotify = options.onNotify;
    this.intervalS = options.intervalS ?? 30 * 60;
    this.enabled = options.enabled ?? true;
  }

  get heartbeatFile(): string {
    return path.join(this.workspace, "HEARTBEAT.md");
  }

  private async readHeartbeatFile(): Promise<string | null> {
    try {
      const content = await readFile(this.heartbeatFile, "utf8");
      return content.trim() ? content : null;
    } catch {
      return null;
    }
  }

  private async decide(content: string): Promise<{ action: "skip" | "run"; tasks: string }> {
    const response = await this.provider.chat({
      messages: [
        {
          role: "system",
          content:
            "You are a heartbeat agent. Call the heartbeat tool to report your decision.",
        },
        {
          role: "user",
          content: `Review the following HEARTBEAT.md and decide whether there are active tasks.\n\n${content}`,
        },
      ],
      tools: HEARTBEAT_TOOL as unknown as Array<Record<string, unknown>>,
      model: this.model,
    });

    const call = response.toolCalls.find((toolCall) => toolCall.name === "heartbeat");
    if (!call) {
      return { action: "skip", tasks: "" };
    }
    const action = call.arguments.action === "run" ? "run" : "skip";
    const tasks =
      typeof call.arguments.tasks === "string" ? call.arguments.tasks : "";
    return { action, tasks };
  }

  async start(): Promise<void> {
    if (!this.enabled || this.running) {
      return;
    }
    this.running = true;
    this.task = this.runLoop();
  }

  stop(): void {
    this.running = false;
    this.task = null;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, this.intervalS * 1000));
      if (!this.running) {
        break;
      }
      await this.tick();
    }
  }

  private async tick(): Promise<void> {
    const content = await this.readHeartbeatFile();
    if (!content) {
      return;
    }

    try {
      const decision = await this.decide(content);
      if (decision.action !== "run" || !this.onExecute) {
        return;
      }
      const output = await this.onExecute(decision.tasks);
      if (output && this.onNotify) {
        await this.onNotify(output);
      }
    } catch {
      // Keep heartbeat resilient; errors should not crash process.
    }
  }

  async triggerNow(): Promise<string | null> {
    const content = await this.readHeartbeatFile();
    if (!content || !this.onExecute) {
      return null;
    }
    const decision = await this.decide(content);
    if (decision.action !== "run") {
      return null;
    }
    return this.onExecute(decision.tasks);
  }
}

