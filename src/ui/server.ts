import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { loadOrCreateConfig } from "../config/loader.js";
import { UiMockState } from "./mock-state.js";

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
