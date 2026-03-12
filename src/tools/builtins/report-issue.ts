import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { OutboundMessage } from "../../bus/events.js";
import { Tool } from "../core/tool.js";
import { WorkflowRunActivityHistoryRepository } from "../../workflow/run-activity-history.js";
import { WorkflowRunHistoryRepository } from "../../workflow/run-history.js";

type MessageSender = (message: OutboundMessage) => Promise<void>;

const REDACTION_PATTERNS: RegExp[] = [
  /((?:api[_-]?key|app[_-]?secret|secret|token|authorization)["'\s:=]+)([^\s"',}]+)/gi,
  /\b(sk-[A-Za-z0-9_-]{12,})\b/g,
  /\b(cli_[A-Za-z0-9_-]{8,})\b/g,
];

function redactText(input: string): string {
  let output = input;
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern, (_match, prefix?: string) =>
      prefix ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return output;
}

function safeReportName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function safeSessionFilename(channel: string, chatId: string): string {
  return `${channel}_${chatId}`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isoCompact(date: Date): string {
  return date.toISOString().replace(/[:]/g, "-");
}

function parseLogTimestamp(line: string): number | null {
  const match = line.match(/^\[([^\]]+)\]/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

export class ReportIssueTool extends Tool {
  readonly name = "report_issue";
  readonly description =
    "Bundle recent runtime logs and current session/workflow context into a diagnostic report file, then optionally send it to a target chat.";
  readonly parameters = {
    type: "object",
    properties: {
      note: {
        type: "string",
        description: "Short description of the bug or dissatisfaction.",
      },
      channel: {
        type: "string",
        description: "Optional target channel. Defaults to the current channel.",
      },
      chat_id: {
        type: "string",
        description: "Optional target chat/user ID. Defaults to the current chat.",
      },
      minutes: {
        type: "integer",
        description: "How many recent minutes of logs to include.",
        minimum: 1,
        maximum: 1440,
      },
      include_session: {
        type: "boolean",
        description: "Whether to include the current session file.",
      },
      include_workflows: {
        type: "boolean",
        description: "Whether to include recent workflow runs and activities.",
      },
      max_log_lines: {
        type: "integer",
        description: "Maximum number of lines to keep per log file.",
        minimum: 50,
        maximum: 5000,
      },
      send: {
        type: "boolean",
        description: "Whether to send the generated report immediately.",
      },
    },
    required: ["note"],
  } as const;

  private defaultChannel = "";
  private defaultChatId = "";

  constructor(
    private readonly workspace: string,
    private readonly sendCallback: MessageSender,
    private readonly options?: {
      logsDir?: string;
      reportsDir?: string;
      workflowRuns?: WorkflowRunHistoryRepository;
      workflowActivities?: WorkflowRunActivityHistoryRepository;
    },
  ) {
    super();
  }

  setContext(channel: string, chatId: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const note = String(params.note ?? "").trim();
    if (!note) {
      return "Error: note is required";
    }

    const channel = String(params.channel ?? this.defaultChannel).trim();
    const chatId = String(params.chat_id ?? this.defaultChatId).trim();
    const minutes = typeof params.minutes === "number" ? params.minutes : 30;
    const includeSession = params.include_session !== false;
    const includeWorkflows = params.include_workflows !== false;
    const maxLogLines = typeof params.max_log_lines === "number" ? params.max_log_lines : 400;
    const shouldSend = params.send !== false;

    const report = {
      generated_at: new Date().toISOString(),
      note,
      context: {
        channel: this.defaultChannel,
        chat_id: this.defaultChatId,
        workspace: this.workspace,
      },
      logs: await this.collectLogs(minutes, maxLogLines),
      session: includeSession ? await this.collectSession() : null,
      workflows: includeWorkflows ? await this.collectWorkflows() : null,
    };

    const reportsDir =
      this.options?.reportsDir ?? path.join(os.homedir(), ".openintern", "reports");
    await mkdir(reportsDir, { recursive: true });
    const reportPath = path.join(
      reportsDir,
      safeReportName(`issue-report-${isoCompact(new Date())}-${randomUUID().slice(0, 8)}.json`),
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (shouldSend) {
      if (!channel || !chatId) {
        return `Error: Report created at ${reportPath}, but no target channel/chat was specified for sending.`;
      }
      await this.sendCallback({
        channel,
        chatId,
        content: `问题报告已生成并发送。\n说明：${note}\n文件：${path.basename(reportPath)}`,
        media: [reportPath],
        metadata: {
          _issue_report: true,
        },
      });
    }

    return JSON.stringify(
      {
        ok: true,
        path: reportPath,
        sent: shouldSend,
        target: shouldSend ? `${channel}:${chatId}` : null,
      },
      null,
      2,
    );
  }

  private async collectLogs(minutes: number, maxLines: number): Promise<
    Array<{
      file: string;
      lines: string[];
    }>
  > {
    const logsDir = this.options?.logsDir ?? path.join(os.homedir(), ".openintern", "logs");
    await mkdir(logsDir, { recursive: true });
    const names = await readdir(logsDir);
    const cutoff = Date.now() - minutes * 60_000;
    const out: Array<{ file: string; lines: string[] }> = [];

    for (const name of names.sort()) {
      if (!name.endsWith(".log")) {
        continue;
      }
      const filePath = path.join(logsDir, name);
      const raw = await readFile(filePath, "utf8").catch(() => "");
      if (!raw) {
        continue;
      }
      const lines = raw
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .filter((line) => {
          const ts = parseLogTimestamp(line);
          return ts === null || ts >= cutoff;
        })
        .slice(-maxLines)
        .map((line) => redactText(line));
      if (lines.length > 0) {
        out.push({
          file: name,
          lines,
        });
      }
    }

    return out;
  }

  private async collectSession(): Promise<{ file: string; content: string } | null> {
    if (!this.defaultChannel || !this.defaultChatId) {
      return null;
    }
    const fileName = `${safeSessionFilename(this.defaultChannel, this.defaultChatId)}.jsonl`;
    const sessionPath = path.join(this.workspace, "sessions", fileName);
    const raw = await readFile(sessionPath, "utf8").catch(() => "");
    if (!raw) {
      return null;
    }
    return {
      file: sessionPath,
      content: redactText(raw),
    };
  }

  private async collectWorkflows(): Promise<{
    runs: unknown[];
    activities: Record<string, unknown[]>;
  } | null> {
    const workflowRuns =
      this.options?.workflowRuns ?? new WorkflowRunHistoryRepository(this.workspace);
    const workflowActivities =
      this.options?.workflowActivities ?? new WorkflowRunActivityHistoryRepository(this.workspace);
    const runs = await workflowRuns.list({ limit: 5 });
    if (runs.length === 0) {
      return {
        runs: [],
        activities: {},
      };
    }

    const activities: Record<string, unknown[]> = {};
    for (const run of runs) {
      activities[run.runId] = await workflowActivities.list(run.runId, { limit: 20 });
    }
    return {
      runs,
      activities,
    };
  }
}
