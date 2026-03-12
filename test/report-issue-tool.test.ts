import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { OutboundMessage } from "../src/bus/events.js";
import { ReportIssueTool } from "../src/tools/builtins/report-issue.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("ReportIssueTool", () => {
  it("creates a diagnostic report and sends it as an attachment", async () => {
    const workspace = await makeTempDir("report-issue-workspace-");
    const logsDir = await makeTempDir("report-issue-logs-");
    const reportsDir = await makeTempDir("report-issue-reports-");

    await mkdir(path.join(workspace, "sessions"), { recursive: true });
    await writeFile(
      path.join(workspace, "sessions", "feishu_test-user.jsonl"),
      '{"_type":"metadata"}\n{"role":"user","content":"token=secret-value"}\n',
      "utf8",
    );
    await writeFile(
      path.join(logsDir, "gateway.log"),
      `[${new Date().toISOString()}] [INFO] [gateway] appSecret=abcd inbound ok\n`,
      "utf8",
    );

    const sent: OutboundMessage[] = [];
    const tool = new ReportIssueTool(
      workspace,
      async (message) => {
        sent.push(message);
      },
      {
        logsDir,
        reportsDir,
      },
    );
    tool.setContext("feishu", "test-user");

    const raw = await tool.execute({
      note: "用户反馈结果不对",
      minutes: 60,
    });
    const parsed = JSON.parse(raw) as {
      ok: boolean;
      path: string;
      sent: boolean;
      target: string;
    };

    expect(parsed.ok).toBe(true);
    expect(parsed.sent).toBe(true);
    expect(parsed.target).toBe("feishu:test-user");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe("feishu");
    expect(sent[0]?.chatId).toBe("test-user");
    expect(sent[0]?.media).toHaveLength(1);

    const reportPath = sent[0]?.media?.[0] ?? parsed.path;
    const saved = await readFile(reportPath, "utf8");
    expect(saved).toContain("用户反馈结果不对");
    expect(saved).toContain("[REDACTED]");
    expect(saved).not.toContain("secret-value");
    expect(saved).not.toContain("appSecret=abcd");
  });

  it("can create a report without sending it immediately", async () => {
    const workspace = await makeTempDir("report-issue-workspace-");
    const logsDir = await makeTempDir("report-issue-logs-");
    const reportsDir = await makeTempDir("report-issue-reports-");

    const sendSpy = vi.fn(async (_message: OutboundMessage) => undefined);
    const tool = new ReportIssueTool(workspace, sendSpy, {
      logsDir,
      reportsDir,
    });
    tool.setContext("feishu", "test-user");

    const raw = await tool.execute({
      note: "只生成不发送",
      send: false,
    });
    const parsed = JSON.parse(raw) as { ok: boolean; sent: boolean; path: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.sent).toBe(false);
    expect(await readFile(parsed.path, "utf8")).toContain("只生成不发送");
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
