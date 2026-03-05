import { randomUUID } from "node:crypto";

import type {
  StartWorkflowOptions,
  WorkflowRunHandle,
  WorkflowRunSnapshot,
} from "../../workflow/engine.js";
import { parseWorkflowDefinition, type WorkflowDefinition } from "../../workflow/schema.js";
import { buildWorkflowDraftReviewUrl } from "../../workflow/review-link.js";
import { WorkflowRepository } from "../../workflow/repository.js";
import { MIN_WORKFLOW_EXAMPLE, WORKFLOW_SCHEMA_HINT } from "../../workflow/schema-hint.js";
import { Tool } from "../core/tool.js";

export interface WorkflowRuntime {
  start(definitionInput: unknown, options: StartWorkflowOptions): Promise<WorkflowRunHandle>;
  getRunSnapshot(runId: string): WorkflowRunSnapshot | null;
}

export interface WorkflowRunSnapshotLookup {
  load(runId: string): Promise<WorkflowRunSnapshot | null>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeIdentifier(input: string, fallback: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return fallback;
  }
  return normalized.slice(0, 48);
}

function summaryFromSnapshot(snapshot: WorkflowRunSnapshot): string {
  const completed = snapshot.nodes.filter((node) => node.status === "completed").length;
  const failed = snapshot.nodes.filter((node) => node.status === "failed").length;
  const waiting = snapshot.nodes.filter((node) => node.status === "waiting_for_approval").length;

  if (snapshot.status === "completed") {
    return `Workflow '${snapshot.workflowId}' completed. ${completed}/${snapshot.nodes.length} nodes succeeded.`;
  }
  if (snapshot.status === "failed") {
    const reason = snapshot.error ? ` Error: ${snapshot.error}` : "";
    return `Workflow '${snapshot.workflowId}' failed. ${failed} node(s) failed.${reason}`;
  }
  if (snapshot.status === "cancelled") {
    return `Workflow '${snapshot.workflowId}' was cancelled.`;
  }
  if (snapshot.status === "waiting_for_approval") {
    return `Workflow '${snapshot.workflowId}' is waiting for approval (${waiting} node(s) blocked).`;
  }
  return `Workflow '${snapshot.workflowId}' is running (${completed}/${snapshot.nodes.length} completed).`;
}

function executionFlowFromSnapshot(snapshot: WorkflowRunSnapshot): {
  completed: number;
  running: number;
  waiting_for_approval: number;
  failed: number;
  pending: number;
  nodes: Array<{
    id: string;
    name?: string;
    role?: string;
    status: "pending" | "running" | "waiting_for_approval" | "completed" | "failed";
    attempt: number;
    maxAttempts: number;
    currentTaskId: string | null;
    lastError: string | null;
  }>;
} {
  const counts = {
    completed: 0,
    running: 0,
    waiting_for_approval: 0,
    failed: 0,
    pending: 0,
  };
  for (const node of snapshot.nodes) {
    counts[node.status] += 1;
  }
  return {
    ...counts,
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      status: node.status,
      attempt: node.attempt,
      maxAttempts: node.maxAttempts,
      currentTaskId: node.currentTaskId,
      lastError: node.lastError,
    })),
  };
}

function defaultWorkflowFromInstruction(instruction: string, workflowId?: string): WorkflowDefinition {
  const id = toSafeIdentifier(workflowId ?? "", "wf_draft") || "wf_draft";
  const prompt =
    instruction.trim() ||
    "Execute the requested workflow task and return JSON with key 'result'.";

  return {
    id,
    name: instruction.trim().slice(0, 80) || "Draft workflow",
    trigger: {
      type: "manual",
    },
    nodes: [
      {
        id: "node_main",
        role: "scientist",
        taskPrompt: `${prompt} Keep output concise and structured.`,
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

const WORKFLOW_JSON_SCHEMA = {
  type: "object",
  description: "WorkflowDefinition object.",
  properties: {
    id: { type: "string", description: "Workflow ID." },
    name: { type: "string", description: "Optional workflow display name." },
    trigger: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["manual"],
          description: "Trigger type; currently must be 'manual'.",
        },
      },
      required: ["type"],
    },
    execution: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["serial", "parallel"],
          description: "Execution mode.",
        },
        maxParallel: { type: "integer", description: "When mode=parallel, positive integer." },
      },
    },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          skillNames: {
            type: "array",
            items: { type: "string" },
          },
          taskPrompt: { type: "string" },
          dependsOn: {
            type: "array",
            items: { type: "string" },
          },
          outputKeys: {
            type: "array",
            items: { type: "string" },
          },
          retry: {
            type: "object",
            properties: {
              maxAttempts: { type: "integer" },
              backoffMs: { type: "integer" },
            },
            required: ["maxAttempts"],
          },
          hitl: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              highRiskTools: {
                type: "array",
                items: { type: "string" },
              },
              approvalTarget: {
                type: "string",
                enum: ["owner", "group"],
              },
              approvalTimeoutMs: { type: "integer" },
            },
            required: ["enabled", "highRiskTools"],
          },
        },
        required: ["id", "role", "taskPrompt", "dependsOn"],
      },
      description: "Non-empty DAG node definitions.",
    },
  },
  required: ["id", "trigger", "nodes"],
} as const;

export class TriggerWorkflowTool extends Tool {
  readonly name = "trigger_workflow";
  readonly description = "Trigger a published SOP workflow by workflow_id and return instance_id.";
  readonly parameters = {
    type: "object",
    properties: {
      workflow_id: {
        type: "string",
        description: "Published workflow ID from workflows/<workflow_id>.json",
      },
      trigger_input: {
        type: "object",
        description: "Optional trigger input object available as {{trigger.*}} in node prompts.",
      },
    },
    required: ["workflow_id"],
  } as const;

  private originChannel = "cli";
  private originChatId = "direct";

  constructor(
    private readonly runtime: WorkflowRuntime,
    private readonly repository: WorkflowRepository,
  ) {
    super();
  }

  setContext(channel: string, chatId: string): void {
    this.originChannel = channel;
    this.originChatId = chatId;
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const workflowId = String(params.workflow_id ?? "").trim();
    const triggerInput = isObject(params.trigger_input) ? params.trigger_input : {};

    try {
      const definition = await this.repository.loadPublished(workflowId);
      const startOptions: StartWorkflowOptions = {
        triggerInput,
        originChannel: this.originChannel,
        originChatId: this.originChatId,
      };
      const handle = await this.runtime.start(definition, startOptions);
      const snapshot = this.runtime.getRunSnapshot(handle.runId);
      if (!snapshot) {
        throw new Error(`Workflow '${workflowId}' started but no run snapshot found.`);
      }

      return JSON.stringify(
        {
          ok: true,
          workflow_id: workflowId,
          instance_id: handle.runId,
          summary: summaryFromSnapshot(snapshot),
          snapshot,
        },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: Failed to trigger workflow '${workflowId}': ${message}`;
    }
  }
}

export class QueryWorkflowStatusTool extends Tool {
  readonly name = "query_workflow_status";
  readonly description = "Query workflow run status by instance_id and return summary + execution flow + snapshot.";
  readonly parameters = {
    type: "object",
    properties: {
      instance_id: {
        type: "string",
        description: "Workflow run instance ID returned by trigger_workflow.",
      },
    },
    required: ["instance_id"],
  } as const;

  constructor(
    private readonly runtime: WorkflowRuntime,
    private readonly history?: WorkflowRunSnapshotLookup,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const instanceId = String(params.instance_id ?? "").trim();
    const liveSnapshot = this.runtime.getRunSnapshot(instanceId);
    if (!liveSnapshot) {
      const historical = this.history ? await this.history.load(instanceId) : null;
      if (!historical) {
        return (
          `Error: Workflow instance '${instanceId}' not found in current agent runtime. ` +
          "It may have finished in another process, or this runtime was restarted."
        );
      }
      return JSON.stringify(
        {
          ok: true,
          instance_id: instanceId,
          summary: summaryFromSnapshot(historical),
          execution_flow: executionFlowFromSnapshot(historical),
          snapshot: historical,
          from_history: true,
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        ok: true,
        instance_id: instanceId,
        summary: summaryFromSnapshot(liveSnapshot),
        execution_flow: executionFlowFromSnapshot(liveSnapshot),
        snapshot: liveSnapshot,
        from_history: false,
      },
      null,
      2,
    );
  }
}

export class DraftWorkflowTool extends Tool {
  readonly name = "draft_workflow";
  readonly description = [
    "Draft a workflow JSON and save it to workflows/drafts/.",
    "If workflow_json is provided, it MUST satisfy the schema below.",
    WORKFLOW_SCHEMA_HINT,
  ].join("\n\n");
  readonly parameters = {
    type: "object",
    properties: {
      instruction: {
        type: "string",
        description: "Natural language description of the workflow to draft.",
      },
      workflow_id: {
        type: "string",
        description: "Optional base workflow ID to reuse for the draft.",
      },
      workflow_json: WORKFLOW_JSON_SCHEMA,
    },
    required: ["instruction"],
  } as const;

  constructor(
    private readonly repository: WorkflowRepository,
    private readonly gatewayHost: string,
    private readonly gatewayPort: number,
    private readonly publicBase?: string,
  ) {
    super();
  }

  async execute(params: Record<string, unknown>): Promise<string> {
    const instruction = String(params.instruction ?? "").trim();
    const requestedWorkflowId = String(params.workflow_id ?? "").trim();
    const workflowJson = params.workflow_json;

    let definitionCandidate: WorkflowDefinition;
    if (isObject(workflowJson)) {
      const cloned = structuredClone(workflowJson) as Record<string, unknown>;
      if (requestedWorkflowId) {
        cloned.id = requestedWorkflowId;
      }
      definitionCandidate = cloned as unknown as WorkflowDefinition;
    } else {
      definitionCandidate = defaultWorkflowFromInstruction(instruction, requestedWorkflowId);
    }

    let normalized: ReturnType<typeof parseWorkflowDefinition>;
    try {
      normalized = parseWorkflowDefinition(definitionCandidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: Invalid workflow_json. ${message}\n\n${WORKFLOW_SCHEMA_HINT}`;
    }

    const baseId = toSafeIdentifier(normalized.id, "wf_draft");
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    const nonce = randomUUID().replace(/-/g, "").slice(0, 6);
    const draftId = `${baseId}_${stamp}_${nonce}`;

    try {
      const filePath = await this.repository.saveDraft(draftId, normalized);
      const reviewUrl = buildWorkflowDraftReviewUrl({
        draftId,
        gatewayHost: this.gatewayHost,
        gatewayPort: this.gatewayPort,
        publicBase: this.publicBase,
      });

      return JSON.stringify(
        {
          ok: true,
          draft_id: draftId,
          workflow_id: normalized.id,
          path: filePath,
          review_url: reviewUrl,
          summary: `Draft '${draftId}' created and ready for review.`,
          definition: normalized,
        },
        null,
        2,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error: Failed to save workflow draft '${draftId}'. ${message}`;
    }
  }
}

export { MIN_WORKFLOW_EXAMPLE, WORKFLOW_SCHEMA_HINT };
