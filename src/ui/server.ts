import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { SubagentManager } from "../agent/subagent/manager.js";
import { MessageBus } from "../bus/message-bus.js";
import { loadOrCreateConfig, resolveWorkspacePath } from "../config/loader.js";
import { makeProvider } from "../llm/provider-factory.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { UiMockState } from "./mock-state.js";
import { UiRuntimeState } from "./runtime-state.js";

interface JsonResponse {
  ok: boolean;
  message?: string;
  [key: string]: unknown;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(
  res: import("node:http").ServerResponse,
  statusCode: number,
  payload: JsonResponse,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", MIME[".json"]);
  res.end(JSON.stringify(payload));
}

async function readJsonBody<T>(req: import("node:http").IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const part = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += part.byteLength;
    if (totalBytes > 1024 * 1024) {
      throw new Error("请求体超过 1MB");
    }
    chunks.push(part);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {} as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("JSON 解析失败");
  }
}

async function serveStatic(
  pathname: string,
  publicDir: string,
  res: import("node:http").ServerResponse,
): Promise<boolean> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  if (safePath.includes("..")) {
    sendJson(res, 400, { ok: false, message: "非法路径" });
    return true;
  }

  const absolute = path.join(publicDir, safePath);
  const normalized = path.normalize(absolute);
  if (!normalized.startsWith(publicDir)) {
    sendJson(res, 403, { ok: false, message: "访问被拒绝" });
    return true;
  }

  try {
    const fileStat = await stat(normalized);
    if (fileStat.isDirectory()) {
      return serveStatic(path.join(pathname, "index.html"), publicDir, res);
    }

    const ext = path.extname(normalized);
    const contentType = MIME[ext] ?? "application/octet-stream";
    const content = await readFile(normalized);

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const state = new UiMockState(config);
  let runtime: UiRuntimeState | null = null;
  let runtimeInitError: string | null = null;

  try {
    const bus = new MessageBus();
    const provider = makeProvider(config);
    const workspace = resolveWorkspacePath(config);
    await mkdir(workspace, { recursive: true });
    await syncWorkspaceTemplates(workspace);

    const subagents = new SubagentManager({
      provider,
      workspace,
      bus,
      model: config.agents.defaults.model,
      temperature: config.agents.defaults.temperature,
      maxTokens: config.agents.defaults.maxTokens,
      reasoningEffort: config.agents.defaults.reasoningEffort,
      webSearchApiKey: config.tools.web.search.apiKey,
      webSearchMaxResults: config.tools.web.search.maxResults,
      webProxy: config.tools.web.proxy,
      execTimeoutSeconds: config.tools.exec.timeout,
      restrictToWorkspace: config.tools.restrictToWorkspace,
      config,
      maxConcurrent: config.agents.subagentConcurrency.maxConcurrent,
    });
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace,
      config,
    });
    runtime = new UiRuntimeState({
      bus,
      engine,
    });
  } catch (error) {
    runtimeInitError = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Runtime workflow init skipped: ${runtimeInitError}\n`);
  }

  const distDir = path.resolve(process.cwd(), "src", "ui", "frontend", "dist");
  const host = process.env.OPENINTERN_UI_HOST || config.gateway.host || "127.0.0.1";
  const defaultPort = Number.isFinite(config.gateway.port) ? config.gateway.port + 1 : 18890;
  const port = Number.parseInt(process.env.OPENINTERN_UI_PORT || "", 10) || defaultPort;

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const base = `http://${req.headers.host ?? "127.0.0.1"}`;
    const requestUrl = new URL(req.url ?? "/", base);
    const pathname = requestUrl.pathname;

    try {
      if (pathname === "/healthz") {
        sendJson(res, 200, { ok: true, service: "openintern-ui" });
        return;
      }

      if (pathname === "/api/state" && method === "GET") {
        sendJson(res, 200, { ok: true, data: state.getSnapshot() });
        return;
      }

      if (pathname === "/api/runtime/hitl/stream" && method === "GET") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        runtime.attachApprovalStream(res);
        return;
      }

      if (pathname === "/api/runtime/hitl/approvals" && method === "GET") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          data: {
            approvals: runtime.listApprovals({ pendingOnly: true }),
          },
        });
        return;
      }

      if (
        pathname.startsWith("/api/runtime/hitl/approvals/") &&
        pathname.endsWith("/approve") &&
        method === "POST"
      ) {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        const approvalId = pathname
          .replace("/api/runtime/hitl/approvals/", "")
          .replace("/approve", "")
          .trim();
        const body = await readJsonBody<{ approver?: string }>(req);
        await runtime.approve(approvalId, body.approver ?? "researcher");
        sendJson(res, 200, {
          ok: true,
          data: {
            approvals: runtime.listApprovals({ pendingOnly: true }),
          },
        });
        return;
      }

      if (pathname === "/api/runtime/workflows/start" && method === "POST") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }

        const body = await readJsonBody<{
          definition: unknown;
          triggerInput?: Record<string, unknown>;
          originChannel?: string;
          originChatId?: string;
        }>(req);
        const started = await runtime.startWorkflow({
          definition: body.definition,
          triggerInput: body.triggerInput,
          originChannel: body.originChannel,
          originChatId: body.originChatId,
        });
        const run = runtime.getRun(started.runId);
        sendJson(res, 200, {
          ok: true,
          data: {
            runId: started.runId,
            run,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflows/") && method === "GET") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        const runId = pathname.replace("/api/runtime/workflows/", "").trim();
        const run = runtime.getRun(runId);
        if (!run) {
          sendJson(res, 404, { ok: false, message: "Run not found" });
          return;
        }
        sendJson(res, 200, { ok: true, data: { run } });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflows/") && pathname.endsWith("/cancel") && method === "POST") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        const runId = pathname.replace("/api/runtime/workflows/", "").replace("/cancel", "").trim();
        await runtime.cancelRun(runId);
        sendJson(res, 200, {
          ok: true,
          data: {
            run: runtime.getRun(runId),
          },
        });
        return;
      }

      if (pathname === "/api/workflow/nodes" && method === "POST") {
        const body = await readJsonBody<{
          kind: "trigger" | "agent" | "action";
          name: string;
          description?: string;
          role?: string | null;
        }>(req);
        const node = state.addNode(body);
        sendJson(res, 200, { ok: true, node, data: state.getSnapshot() });
        return;
      }

      if (pathname.startsWith("/api/workflow/nodes/") && method === "PATCH") {
        const nodeId = pathname.replace("/api/workflow/nodes/", "").trim();
        const body = await readJsonBody<{
          name?: string;
          description?: string;
          role?: string | null;
          requiresApproval?: boolean;
          approvalTarget?: "owner" | "group";
          toolIds?: string[];
        }>(req);
        const node = state.updateNode(nodeId, body);
        sendJson(res, 200, { ok: true, node, data: state.getSnapshot() });
        return;
      }

      if (pathname === "/api/workflow/edges" && method === "POST") {
        const body = await readJsonBody<{ from: string; to: string }>(req);
        const edge = state.addEdge(body);
        sendJson(res, 200, { ok: true, edge, data: state.getSnapshot() });
        return;
      }

      if (pathname === "/api/runs/start" && method === "POST") {
        const run = state.startRun();
        sendJson(res, 200, { ok: true, run, data: state.getSnapshot() });
        return;
      }

      if (pathname.startsWith("/api/approvals/") && pathname.endsWith("/approve") && method === "POST") {
        const approvalId = pathname.replace("/api/approvals/", "").replace("/approve", "").trim();
        const body = await readJsonBody<{ approver?: string }>(req);
        const run = await state.approve(approvalId, body.approver ?? "researcher");
        sendJson(res, 200, { ok: true, run, data: state.getSnapshot() });
        return;
      }

      if (pathname === "/api/registry/tools" && method === "POST") {
        const body = await readJsonBody<{
          name: string;
          description: string;
          inputSchema: string;
          riskLevel: "low" | "high";
          scriptName?: string;
          scriptContent?: string;
        }>(req);
        const tool = state.registerTool(body);
        sendJson(res, 200, { ok: true, tool, data: state.getSnapshot() });
        return;
      }

      const served = await serveStatic(pathname, distDir, res);
      const isSpaGet = method === "GET" && !pathname.startsWith("/api/");
      const servedSpaIndex = !served && isSpaGet ? await serveStatic("/index.html", distDir, res) : false;
      if (!served && !servedSpaIndex) {
        sendJson(res, 404, {
          ok: false,
          message:
            "Not Found. In React dev mode use pnpm dev:ui. For static build run pnpm build:ui first.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 400, { ok: false, message });
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(`OpenIntern UI server running at http://${host}:${port}\n`);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`UI server failed: ${message}\n`);
  process.exitCode = 1;
});
