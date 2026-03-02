import { Tool } from "../core/tool.js";
import type { CronService } from "../../cron/service.js";
import type { CronSchedule } from "../../cron/types.js";

export class CronTool extends Tool {
  readonly name = "cron";
  readonly description = "Schedule reminders and recurring tasks. Actions: add, list, remove.";
  readonly parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove"],
        description: "Action to perform",
      },
      message: { type: "string", description: "Reminder message (for add)" },
      every_seconds: {
        type: "integer",
        description: "Interval in seconds (for recurring tasks)",
      },
      cron_expr: {
        type: "string",
        description: "Cron expression like '0 9 * * *' (for scheduled tasks)",
      },
      tz: {
        type: "string",
        description: "IANA timezone for cron expressions (e.g. 'America/Vancouver')",
      },
      at: {
        type: "string",
        description: "ISO datetime for one-time execution (e.g. '2026-02-12T10:30:00')",
      },
      job_id: {
        type: "string",
        description: "Job ID (for remove)",
      },
    },
    required: ["action"],
  } as const;

  private channel = "";
  private chatId = "";

  constructor(private readonly cron: CronService) {
    super();
  }

  setContext(channel: string, chatId: string): void {
    this.channel = channel;
    this.chatId = chatId;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const action = String(params.action ?? "");
    const message = String(params.message ?? "");
    const everySeconds =
      params.every_seconds === undefined ? null : Number(params.every_seconds);
    const cronExpr =
      params.cron_expr === undefined ? null : String(params.cron_expr);
    const tz = params.tz === undefined ? null : String(params.tz);
    const at = params.at === undefined ? null : String(params.at);
    const jobId = params.job_id === undefined ? null : String(params.job_id);

    if (action === "add") {
      return this.addJob(message, everySeconds, cronExpr, tz, at);
    }
    if (action === "list") {
      return this.listJobs();
    }
    if (action === "remove") {
      return this.removeJob(jobId);
    }
    return `Unknown action: ${action}`;
  }

  private async addJob(
    message: string,
    everySeconds: number | null,
    cronExpr: string | null,
    tz: string | null,
    at: string | null,
  ): Promise<string> {
    if (!message.trim()) {
      return "Error: message is required for add";
    }
    if (!this.channel || !this.chatId) {
      return "Error: no session context (channel/chat_id)";
    }
    if (tz && !cronExpr) {
      return "Error: tz can only be used with cron_expr";
    }

    let schedule: CronSchedule;
    let deleteAfterRun = false;

    if (everySeconds && Number.isFinite(everySeconds) && everySeconds > 0) {
      schedule = {
        kind: "every",
        everyMs: Math.floor(everySeconds * 1000),
      };
    } else if (cronExpr) {
      schedule = {
        kind: "cron",
        expr: cronExpr,
        tz,
      };
    } else if (at) {
      const dt = new Date(at);
      if (Number.isNaN(dt.getTime())) {
        return "Error: invalid ISO datetime in 'at'";
      }
      schedule = {
        kind: "at",
        atMs: dt.getTime(),
      };
      deleteAfterRun = true;
    } else {
      return "Error: either every_seconds, cron_expr, or at is required";
    }

    try {
      const job = await this.cron.addJob({
        name: message.slice(0, 30),
        schedule,
        message,
        deliver: true,
        channel: this.channel,
        to: this.chatId,
        deleteAfterRun,
      });
      return `Created job '${job.name}' (id: ${job.id})`;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return `Error: ${msg}`;
    }
  }

  private async listJobs(): Promise<string> {
    const jobs = await this.cron.listJobs();
    if (jobs.length === 0) {
      return "No scheduled jobs.";
    }
    return `Scheduled jobs:\n${jobs
      .map((job) => `- ${job.name} (id: ${job.id}, ${job.schedule.kind})`)
      .join("\n")}`;
  }

  private async removeJob(jobId: string | null): Promise<string> {
    if (!jobId) {
      return "Error: job_id is required for remove";
    }
    const removed = await this.cron.removeJob(jobId);
    if (!removed) {
      return `Job ${jobId} not found`;
    }
    return `Removed job ${jobId}`;
  }
}

