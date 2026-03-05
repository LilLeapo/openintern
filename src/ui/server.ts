import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { SubagentManager } from "../agent/subagent/manager.js";
import { MessageBus } from "../bus/message-bus.js";
import { loadOrCreateConfig, resolveWorkspacePath, saveConfig } from "../config/loader.js";
import type { RoleConfig } from "../config/schema.js";
import { makeProvider } from "../llm/provider-factory.js";
import type { LLMProvider } from "../llm/provider.js";
import { McpManager } from "../mcp/mcp-manager.js";
import { syncWorkspaceTemplates } from "../templates/sync.js";
import { ToolRegistry } from "../tools/core/tool-registry.js";
import { WorkflowEngine } from "../workflow/engine.js";
import { extractJsonObject } from "../workflow/interpolation.js";
import { WorkflowRunActivityHistoryRepository } from "../workflow/run-activity-history.js";
import { WorkflowRepository } from "../workflow/repository.js";
import { WorkflowRunHistoryRepository } from "../workflow/run-history.js";
import { recoverRunSnapshot } from "../workflow/run-recovery.js";
import { RuntimeSqliteStore } from "../workflow/runtime-sqlite.js";
import { MIN_WORKFLOW_EXAMPLE, WORKFLOW_SCHEMA_HINT } from "../workflow/schema-hint.js";
import { parseWorkflowDefinition } from "../workflow/schema.js";
import { UiMockState } from "./mock-state.js";
import { UiRuntimeState } from "./runtime-state.js";
import { loadWorkflowDraftReview } from "./draft-api.js";
import { buildRuntimeCatalog } from "./runtime-catalog.js";

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

function asPositiveInt(raw: string | null, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function toSafeId(input: string, fallback: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return fallback;
}

function asPositiveInteger(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return fallback;
  }
  return Math.floor(num);
}

function normalizeToolList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0),
    ),
  );
}

async function persistRecoveredRunSnapshot(options: {
  snapshot: import("../workflow/engine.js").WorkflowRunSnapshot;
  runtimeStore: RuntimeSqliteStore;
  workflowRunHistory: WorkflowRunHistoryRepository;
}): Promise<void> {
  options.runtimeStore.upsertRun(options.snapshot);
  await options.workflowRunHistory.save(options.snapshot);
}

function normalizeRolePatch(input: Record<string, unknown>, fallbackId: string): { id: string; role: RoleConfig } {
  const id = toSafeId(typeof input.id === "string" ? input.id : "", fallbackId);
  const systemPrompt =
    typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0
      ? input.systemPrompt.trim()
      : "You are a domain role. Complete tasks and return structured, concise outputs.";
  const allowedTools = normalizeToolList(input.allowedTools);
  return {
    id,
    role: {
      systemPrompt,
      allowedTools,
      memoryScope: input.memoryScope === "papers" ? "papers" : "chat",
      maxIterations: asPositiveInteger(input.maxIterations, 15),
      workspaceIsolation: asBoolean(input.workspaceIsolation, false),
    },
  };
}

async function optimizeWorkflowDefinition(options: {
  provider: LLMProvider;
  instruction: string;
  definition?: unknown;
  model: string;
  maxTokens: number;
  temperature: number;
  reasoningEffort: string | null;
}): Promise<Record<string, unknown>> {
  const promptBody = {
    instruction: options.instruction,
    currentDefinition: options.definition ?? null,
  };
  const response = await options.provider.chat({
    model: options.model,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort,
    messages: [
      {
        role: "system",
        content: [
          "You optimize OpenIntern workflow JSON definitions.",
          "Return JSON only. Do not include markdown fences.",
          WORKFLOW_SCHEMA_HINT,
          "Minimum valid example:",
          MIN_WORKFLOW_EXAMPLE,
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(promptBody, null, 2),
      },
    ],
  });
  const raw = response.content ?? "";
  return extractJsonObject(raw);
}

async function optimizeRoleDefinition(options: {
  provider: LLMProvider;
  instruction: string;
  role: Record<string, unknown>;
  model: string;
  maxTokens: number;
  temperature: number;
  reasoningEffort: string | null;
}): Promise<Record<string, unknown>> {
  const response = await options.provider.chat({
    model: options.model,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    reasoningEffort: options.reasoningEffort,
    messages: [
      {
        role: "system",
        content: [
          "You optimize OpenIntern role configuration.",
          "Return JSON only with fields: id, systemPrompt, allowedTools, memoryScope, maxIterations, workspaceIsolation.",
          "allowedTools must be an array of strings.",
          "memoryScope must be 'chat' or 'papers'.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            instruction: options.instruction,
            role: options.role,
          },
          null,
          2,
        ),
      },
    ],
  });
  return extractJsonObject(response.content ?? "");
}

function defaultDefinitionFromInstruction(input: {
  instruction?: string;
  workflowId?: string;
}): Record<string, unknown> {
  const workflowId = toSafeId(input.workflowId ?? "", "wf_draft");
  const instruction = (input.instruction ?? "").trim();
  return {
    id: workflowId,
    name: instruction ? instruction.slice(0, 80) : "Draft workflow",
    trigger: {
      type: "manual",
    },
    nodes: [
      {
        id: "node_main",
        name: "Main Task",
        role: "scientist",
        taskPrompt:
          instruction ||
          "Execute task from trigger input and return JSON with key 'result'.",
        dependsOn: [],
        outputKeys: ["result"],
        hitl: {
          enabled: false,
          highRiskTools: [],
        },
      },
    ],
  };
}

async function buildDefinitionSummaryList(options: {
  source: "published" | "draft";
  repository: WorkflowRepository;
}): Promise<
  Array<{
    id: string;
    name: string;
    source: "published" | "draft";
    path: string;
    updatedAt: string;
    valid: boolean;
    error: string | null;
  }>
> {
  const entries =
    options.source === "published"
      ? (await options.repository.listPublished()).map((entry) => ({
          id: entry.workflowId,
          path: entry.path,
          updatedAt: entry.updatedAt,
        }))
      : (await options.repository.listDrafts()).map((entry) => ({
          id: entry.draftId,
          path: entry.path,
          updatedAt: entry.updatedAt,
        }));

  const out: Array<{
    id: string;
    name: string;
    source: "published" | "draft";
    path: string;
    updatedAt: string;
    valid: boolean;
    error: string | null;
  }> = [];

  for (const entry of entries) {
    let definition: unknown;
    try {
      definition =
        options.source === "published"
          ? await options.repository.loadPublished(entry.id)
          : await options.repository.loadDraft(entry.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.push({
        id: entry.id,
        name: entry.id,
        source: options.source,
        path: entry.path,
        updatedAt: entry.updatedAt,
        valid: false,
        error: message,
      });
      continue;
    }

    const candidateName =
      typeof (definition as Record<string, unknown>)?.name === "string"
        ? String((definition as Record<string, unknown>).name)
        : entry.id;
    try {
      parseWorkflowDefinition(definition);
      out.push({
        id: entry.id,
        name: candidateName,
        source: options.source,
        path: entry.path,
        updatedAt: entry.updatedAt,
        valid: true,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      out.push({
        id: entry.id,
        name: candidateName,
        source: options.source,
        path: entry.path,
        updatedAt: entry.updatedAt,
        valid: false,
        error: message,
      });
    }
  }

  return out;
}

async function main(): Promise<void> {
  const config = await loadOrCreateConfig();
  const workspace = resolveWorkspacePath(config);
  await mkdir(workspace, { recursive: true });
  await syncWorkspaceTemplates(workspace);

  const state = new UiMockState(config);
  const workflowRepository = new WorkflowRepository(workspace);
  const workflowRunHistory = new WorkflowRunHistoryRepository(workspace);
  const workflowRunActivityHistory = new WorkflowRunActivityHistoryRepository(workspace);
  const runtimeStore = new RuntimeSqliteStore(workspace);
  if (!runtimeStore.available) {
    process.stderr.write(
      "Runtime SQLite unavailable (node:sqlite not supported in current Node). Falling back to non-SQLite runtime history.\n",
    );
  }
  let runtime: UiRuntimeState | null = null;
  let runtimeProvider: LLMProvider | null = null;
  let runtimeInitError: string | null = null;
  const runtimeExternalTools = new ToolRegistry();
  const runtimeMcpManager = new McpManager();
  const connectRuntimeMcp = async (): Promise<void> => {
    if (Object.keys(config.mcp.servers).length === 0) {
      return;
    }
    try {
      await runtimeMcpManager.connectAll(config.mcp, runtimeExternalTools);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[mcp] runtime connect failed: ${message}\n`);
    }
  };
  void connectRuntimeMcp();

  try {
    const bus = new MessageBus();
    runtimeProvider = makeProvider(config);

    const subagents = new SubagentManager({
      provider: runtimeProvider,
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
      externalToolRegistry: runtimeExternalTools,
    });
    const engine = new WorkflowEngine({
      bus,
      subagents,
      workspace,
      config,
      onSnapshot: async (snapshot) => {
        await workflowRunHistory.save(snapshot);
        runtimeStore.upsertRun(snapshot);
      },
      onActivity: async (activity) => {
        await workflowRunActivityHistory.append(activity.runId, activity);
        runtimeStore.upsertActivity(activity);
      },
    });
    runtime = new UiRuntimeState({
      bus,
      engine,
      store: runtimeStore,
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

      if (pathname === "/api/runtime/events/stream" && method === "GET") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }
        runtime.attachEventStream(res);
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
        runtime.attachEventStream(res);
        return;
      }

      if (pathname === "/api/runtime/catalog" && method === "GET") {
        const catalog = await buildRuntimeCatalog({
          workspace,
          config,
          runtimeAvailable: runtime !== null,
          runtimeInitError,
          extraToolIds: runtimeExternalTools.names,
        });
        sendJson(res, 200, { ok: true, data: catalog });
        return;
      }

      if (pathname === "/api/runtime/roles" && method === "POST") {
        const body = await readJsonBody<Record<string, unknown>>(req);
        const roleIdInput = typeof body.id === "string" ? body.id : "";
        if (!roleIdInput.trim()) {
          sendJson(res, 400, { ok: false, message: "role id is required" });
          return;
        }

        const { id, role } = normalizeRolePatch(body, "role_custom");
        if (id !== toSafeId(roleIdInput, "role_custom")) {
          sendJson(res, 400, { ok: false, message: "invalid role id" });
          return;
        }
        config.roles[id] = role;
        await saveConfig(config);

        sendJson(res, 200, {
          ok: true,
          data: {
            id,
            role,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/assist/optimize-workflow" && method === "POST") {
        if (!runtimeProvider) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "LLM provider is unavailable.",
          });
          return;
        }

        const body = await readJsonBody<{
          instruction?: string;
          definition?: unknown;
        }>(req);
        const instruction = body.instruction?.trim() ?? "";
        if (!instruction && !body.definition) {
          sendJson(res, 400, { ok: false, message: "instruction or definition is required" });
          return;
        }

        const optimizedRaw = await optimizeWorkflowDefinition({
          provider: runtimeProvider,
          instruction,
          definition: body.definition,
          model: config.agents.defaults.model,
          maxTokens: config.agents.defaults.maxTokens,
          temperature: Math.min(0.3, config.agents.defaults.temperature),
          reasoningEffort: config.agents.defaults.reasoningEffort,
        });
        const normalized = parseWorkflowDefinition(optimizedRaw);
        sendJson(res, 200, {
          ok: true,
          data: {
            definition: normalized,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/assist/optimize-role" && method === "POST") {
        if (!runtimeProvider) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "LLM provider is unavailable.",
          });
          return;
        }

        const body = await readJsonBody<{
          instruction?: string;
          roleId?: string;
          role?: Record<string, unknown>;
        }>(req);

        const roleId = toSafeId(body.roleId ?? "", "role_custom");
        const currentRole =
          body.role ??
          ({
            id: roleId,
            ...(config.roles[roleId] ?? {}),
          } satisfies Record<string, unknown>);

        const optimizedRaw = await optimizeRoleDefinition({
          provider: runtimeProvider,
          instruction: body.instruction?.trim() ?? "",
          role: currentRole,
          model: config.agents.defaults.model,
          maxTokens: config.agents.defaults.maxTokens,
          temperature: Math.min(0.3, config.agents.defaults.temperature),
          reasoningEffort: config.agents.defaults.reasoningEffort,
        });
        const normalized = normalizeRolePatch(optimizedRaw, roleId);
        sendJson(res, 200, {
          ok: true,
          data: {
            id: normalized.id,
            role: normalized.role,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/hitl/approvals" && method === "GET") {
        const pendingOnly = requestUrl.searchParams.get("pendingOnly") === "true";
        const liveApprovals = runtime ? runtime.listApprovals({ pendingOnly }) : [];
        const persistedApprovals = runtimeStore.listApprovals({ pendingOnly });
        const merged = new Map<string, (typeof liveApprovals)[number]>();
        for (const approval of persistedApprovals) {
          merged.set(approval.approvalId, approval);
        }
        for (const approval of liveApprovals) {
          merged.set(approval.approvalId, approval);
        }
        const approvals = Array.from(merged.values()).sort((a, b) =>
          b.requestedAt.localeCompare(a.requestedAt),
        );
        sendJson(res, 200, {
          ok: true,
          data: {
            approvals,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/hitl/approvals/test-request" && method === "POST") {
        if (!runtime) {
          sendJson(res, 503, {
            ok: false,
            message: runtimeInitError ?? "Runtime workflow is unavailable.",
          });
          return;
        }

        const body = await readJsonBody<{
          runId?: string;
          workflowId?: string;
          nodeId?: string;
          nodeName?: string;
          approvalTarget?: "owner" | "group";
          commandPreview?: string;
          expiresInMs?: number;
          toolCalls?: Array<{
            id?: string;
            name: string;
            arguments?: Record<string, unknown>;
            highRisk?: boolean;
          }>;
        }>(req);

        const approval = runtime.createMockApproval({
          runId: body.runId,
          workflowId: body.workflowId,
          nodeId: body.nodeId,
          nodeName: body.nodeName,
          approvalTarget: body.approvalTarget,
          commandPreview: body.commandPreview,
          expiresInMs: body.expiresInMs,
          toolCalls: body.toolCalls,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            approval,
            approvals: runtime.listApprovals(),
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
            approvals: runtime.listApprovals(),
          },
        });
        return;
      }

      if (pathname === "/api/runtime/workflows/runs" && method === "GET") {
        const limitRaw = requestUrl.searchParams.get("limit");
        const limit = limitRaw ? asPositiveInt(limitRaw, 200) : 0;
        const fetchLimit = limit > 0 ? Math.max(limit, 500) : 5_000;
        const sqliteRuns = runtimeStore.listRuns({ limit: fetchLimit });
        const historyRuns = await workflowRunHistory.list({ limit: fetchLimit });
        const liveRuns = runtime ? runtime.listRuns({ limit: fetchLimit }) : [];
        const merged = new Map<string, (typeof liveRuns)[number]>();
        for (const run of sqliteRuns) {
          merged.set(run.runId, run);
        }
        for (const run of historyRuns) {
          merged.set(run.runId, run);
        }
        for (const run of liveRuns) {
          merged.set(run.runId, run);
        }
        const sortedRuns = Array.from(merged.values()).sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        );
        const normalizedRuns: Array<(typeof sortedRuns)[number]> = [];
        for (const item of sortedRuns) {
          const recovered = recoverRunSnapshot(item);
          if (recovered.recovered) {
            await persistRecoveredRunSnapshot({
              snapshot: recovered.snapshot,
              runtimeStore,
              workflowRunHistory,
            });
            normalizedRuns.push(recovered.snapshot);
            continue;
          }
          normalizedRuns.push(item);
        }
        const runs = limit > 0 ? normalizedRuns.slice(0, limit) : normalizedRuns;
        sendJson(res, 200, {
          ok: true,
          data: {
            runs,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/traces" && method === "GET") {
        const limit = asPositiveInt(requestUrl.searchParams.get("limit"), 200);
        const runId = requestUrl.searchParams.get("runId")?.trim() || undefined;
        const sqliteTraces = runtimeStore.listTraces({ runId, limit });
        const liveTraces = runtime ? runtime.listTraces({ runId, limit }) : [];
        const merged = new Map<string, (typeof liveTraces)[number]>();
        for (const trace of sqliteTraces) {
          merged.set(trace.id, trace);
        }
        for (const trace of liveTraces) {
          merged.set(trace.id, trace);
        }
        const traces = Array.from(merged.values())
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, limit);
        sendJson(res, 200, {
          ok: true,
          data: {
            traces,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/workflow-defs/published" && method === "GET") {
        const summaries = await buildDefinitionSummaryList({
          source: "published",
          repository: workflowRepository,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            workflows: summaries,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflow-defs/published/") && method === "GET") {
        const workflowId = pathname.replace("/api/runtime/workflow-defs/published/", "").trim();
        if (!workflowId) {
          sendJson(res, 400, { ok: false, message: "workflowId is required" });
          return;
        }
        const definition = await workflowRepository.loadPublished(workflowId);
        let normalized: ReturnType<typeof parseWorkflowDefinition> | null = null;
        let valid = true;
        let error: string | null = null;
        try {
          normalized = parseWorkflowDefinition(definition);
        } catch (validationError) {
          valid = false;
          error =
            validationError instanceof Error ? validationError.message : String(validationError);
        }
        sendJson(res, 200, {
          ok: true,
          data: {
            id: workflowId,
            source: "published",
            definition,
            normalized,
            valid,
            error,
            path: workflowRepository.resolvePublishedPath(workflowId),
          },
        });
        return;
      }

      if (pathname === "/api/runtime/workflow-defs/drafts" && method === "GET") {
        const summaries = await buildDefinitionSummaryList({
          source: "draft",
          repository: workflowRepository,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            workflows: summaries,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflow-defs/drafts/") && method === "GET") {
        const draftId = pathname.replace("/api/runtime/workflow-defs/drafts/", "").trim();
        if (!draftId) {
          sendJson(res, 400, { ok: false, message: "draftId is required" });
          return;
        }
        const data = await loadWorkflowDraftReview({
          repository: workflowRepository,
          draftId,
          gatewayHost: config.gateway.host,
          gatewayPort: config.gateway.port,
          publicBase: process.env.OPENINTERN_UI_PUBLIC_BASE,
        });
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (pathname === "/api/runtime/workflow-defs/drafts" && method === "POST") {
        const body = await readJsonBody<{
          draftId?: string;
          workflowId?: string;
          instruction?: string;
          definition?: Record<string, unknown>;
        }>(req);
        const fallbackId = `${toSafeId(body.workflowId ?? "", "wf_draft")}_${Date.now()}`;
        const draftId = toSafeId(
          body.draftId ?? `${fallbackId}_${randomUUID().replace(/-/g, "").slice(0, 6)}`,
          fallbackId,
        );
        const candidate = body.definition ?? defaultDefinitionFromInstruction(body);
        const normalized = parseWorkflowDefinition(candidate);
        const filePath = await workflowRepository.saveDraft(draftId, normalized);
        const review = await loadWorkflowDraftReview({
          repository: workflowRepository,
          draftId,
          gatewayHost: config.gateway.host,
          gatewayPort: config.gateway.port,
          publicBase: process.env.OPENINTERN_UI_PUBLIC_BASE,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            draftId,
            path: filePath,
            reviewUrl: review.reviewUrl,
            definition: normalized,
          },
        });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflow-defs/drafts/") && method === "PUT") {
        const draftId = pathname.replace("/api/runtime/workflow-defs/drafts/", "").trim();
        if (!draftId) {
          sendJson(res, 400, { ok: false, message: "draftId is required" });
          return;
        }
        const body = await readJsonBody<{ definition: Record<string, unknown> }>(req);
        if (!body.definition || typeof body.definition !== "object") {
          sendJson(res, 400, { ok: false, message: "definition is required" });
          return;
        }
        const normalized = parseWorkflowDefinition(body.definition);
        const filePath = await workflowRepository.saveDraft(draftId, normalized);
        const review = await loadWorkflowDraftReview({
          repository: workflowRepository,
          draftId,
          gatewayHost: config.gateway.host,
          gatewayPort: config.gateway.port,
          publicBase: process.env.OPENINTERN_UI_PUBLIC_BASE,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            draftId,
            path: filePath,
            reviewUrl: review.reviewUrl,
            definition: normalized,
          },
        });
        return;
      }

      if (pathname === "/api/runtime/workflow-defs/publish" && method === "POST") {
        const body = await readJsonBody<{
          draftId?: string;
          workflowId?: string;
          overwrite?: boolean;
          definition?: Record<string, unknown>;
        }>(req);

        let definition: unknown = body.definition;
        if (!definition && body.draftId) {
          definition = await workflowRepository.loadDraft(body.draftId);
        }
        if (!definition) {
          sendJson(res, 400, { ok: false, message: "draftId or definition is required" });
          return;
        }

        const candidate = structuredClone(definition) as Record<string, unknown>;
        if (body.workflowId?.trim()) {
          candidate.id = body.workflowId.trim();
        }
        const normalized = parseWorkflowDefinition(candidate);
        const savedPath = await workflowRepository.savePublished(normalized.id, normalized, {
          overwrite: body.overwrite === true,
        });
        sendJson(res, 200, {
          ok: true,
          data: {
            workflowId: normalized.id,
            path: savedPath,
            definition: normalized,
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
          workflowRef?: {
            source?: "published" | "draft";
            id?: string;
          };
          triggerInput?: Record<string, unknown>;
          originChannel?: string;
          originChatId?: string;
        }>(req);

        let definition: unknown = body.definition;
        if (!definition && body.workflowRef?.id) {
          const refId = body.workflowRef.id;
          if (body.workflowRef.source === "draft") {
            definition = await workflowRepository.loadDraft(refId);
          } else {
            definition = await workflowRepository.loadPublished(refId);
          }
        }
        if (!definition) {
          sendJson(res, 400, { ok: false, message: "definition or workflowRef is required" });
          return;
        }

        const started = await runtime.startWorkflow({
          definition,
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

      if (pathname.startsWith("/api/runtime/workflows/drafts/") && method === "GET") {
        const draftId = pathname.replace("/api/runtime/workflows/drafts/", "").trim();
        if (!draftId) {
          sendJson(res, 400, { ok: false, message: "draftId is required" });
          return;
        }
        const data = await loadWorkflowDraftReview({
          repository: workflowRepository,
          draftId,
          gatewayHost: config.gateway.host,
          gatewayPort: config.gateway.port,
          publicBase: process.env.OPENINTERN_UI_PUBLIC_BASE,
        });
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (pathname.startsWith("/api/runtime/workflows/") && method === "GET") {
        const runId = pathname.replace("/api/runtime/workflows/", "").trim();
        if (!runId || runId.includes("/")) {
          sendJson(res, 404, { ok: false, message: "Run not found" });
          return;
        }
        const runRecord =
          runtime?.getRun(runId) ??
          runtimeStore.getRun(runId) ??
          (await workflowRunHistory.load(runId));
        if (!runRecord) {
          sendJson(res, 404, { ok: false, message: "Run not found" });
          return;
        }
        const recoveredRun = recoverRunSnapshot(runRecord);
        const run = recoveredRun.snapshot;
        if (recoveredRun.recovered) {
          await persistRecoveredRunSnapshot({
            snapshot: run,
            runtimeStore,
            workflowRunHistory,
          });
        }
        const traceLimit = asPositiveInt(requestUrl.searchParams.get("traceLimit"), 200);
        const activityLimit = asPositiveInt(requestUrl.searchParams.get("activityLimit"), 100);
        const sqliteTraces = runtimeStore.listTraces({ runId, limit: traceLimit });
        const liveTraces = runtime?.listTraces({ runId, limit: traceLimit }) ?? [];
        const traceMap = new Map<string, (typeof liveTraces)[number]>();
        for (const trace of sqliteTraces) {
          traceMap.set(trace.id, trace);
        }
        for (const trace of liveTraces) {
          traceMap.set(trace.id, trace);
        }
        const traces = Array.from(traceMap.values())
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, traceLimit);

        const persistedActivities = await workflowRunActivityHistory.list(runId, { limit: activityLimit });
        const sqliteActivities = runtimeStore.listActivities({ runId, limit: activityLimit });
        const liveActivities =
          runtime?.listRunActivities({
            runId,
            limit: activityLimit,
          }) ?? [];
        const activityMap = new Map<string, (typeof liveActivities)[number]>();
        for (const item of sqliteActivities) {
          activityMap.set(item.id, item);
        }
        for (const item of persistedActivities) {
          activityMap.set(item.id, item);
        }
        for (const item of liveActivities) {
          activityMap.set(item.id, item);
        }
        const activities = Array.from(activityMap.values())
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, activityLimit);
        sendJson(res, 200, {
          ok: true,
          data: {
            run,
            traces,
            activities,
          },
        });
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
