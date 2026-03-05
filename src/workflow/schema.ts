export interface WorkflowDefinition {
  id: string;
  name?: string;
  trigger: {
    type: "manual";
  };
  execution?: {
    mode?: "serial" | "parallel";
    maxParallel?: number;
  };
  nodes: WorkflowNodeDefinition[];
}

export interface WorkflowNodeDefinition {
  id: string;
  name?: string;
  role: string;
  skillNames?: string[];
  taskPrompt: string;
  dependsOn: string[];
  outputKeys?: string[];
  retry?: {
    maxAttempts: number;
    backoffMs?: number;
  };
  hitl?: {
    enabled: boolean;
    highRiskTools: string[];
    approvalTarget?: "owner" | "group";
    approvalTimeoutMs?: number;
  };
}

export interface WorkflowExecution {
  mode: "serial" | "parallel";
  maxParallel: number;
}

export interface WorkflowNodeRetry {
  maxAttempts: number;
  backoffMs: number;
}

export interface NormalizedWorkflowNodeDefinition
  extends Omit<
    WorkflowNodeDefinition,
    "skillNames" | "retry" | "dependsOn" | "outputKeys" | "hitl"
  > {
  skillNames: string[];
  dependsOn: string[];
  outputKeys: string[];
  retry: WorkflowNodeRetry;
  hitl: {
    enabled: boolean;
    highRiskTools: string[];
    approvalTarget: "owner" | "group";
    approvalTimeoutMs: number;
  };
}

export interface NormalizedWorkflowDefinition
  extends Omit<WorkflowDefinition, "execution" | "nodes"> {
  execution: WorkflowExecution;
  nodes: NormalizedWorkflowNodeDefinition[];
}

const INTERPOLATION_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== "string") {
    throw new Error(`Workflow ${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    throw new Error(`Workflow ${field} cannot be empty.`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = parseString(value, "name", true);
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringArray(
  value: unknown,
  field: string,
  options?: { defaultEmpty?: boolean },
): string[] {
  if (value === undefined && options?.defaultEmpty) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`Workflow ${field} must be an array of strings.`);
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`Workflow ${field} must contain only strings.`);
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    deduped.add(trimmed);
  }
  return Array.from(deduped);
}

function parsePositiveInt(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`Workflow ${field} must be a positive integer.`);
  }
  return Math.floor(num);
}

function parseNonNegativeInt(value: unknown, field: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Workflow ${field} must be a non-negative integer.`);
  }
  return Math.floor(num);
}

function parseMinInt(value: unknown, field: string, min: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) {
    throw new Error(`Workflow ${field} must be an integer >= ${min}.`);
  }
  return Math.floor(num);
}

function parseRetry(value: unknown, nodeId: string): WorkflowNodeRetry {
  if (value === undefined) {
    return {
      maxAttempts: 1,
      backoffMs: 0,
    };
  }
  if (!isObject(value)) {
    throw new Error(`Workflow node '${nodeId}' retry must be an object.`);
  }
  return {
    maxAttempts: parsePositiveInt(value.maxAttempts, `node '${nodeId}'.retry.maxAttempts`),
    backoffMs:
      value.backoffMs === undefined
        ? 0
        : parseNonNegativeInt(value.backoffMs, `node '${nodeId}'.retry.backoffMs`),
  };
}

function parseHitl(
  value: unknown,
  nodeId: string,
): {
  enabled: boolean;
  highRiskTools: string[];
  approvalTarget: "owner" | "group";
  approvalTimeoutMs: number;
} {
  const defaultHitl = {
    enabled: false,
    highRiskTools: [] as string[],
    approvalTarget: "owner" as const,
    approvalTimeoutMs: 7_200_000,
  };

  if (value === undefined) {
    return defaultHitl;
  }
  if (!isObject(value)) {
    throw new Error(`Workflow node '${nodeId}' hitl must be an object.`);
  }

  const enabled = value.enabled === true;
  const approvalTarget = value.approvalTarget === "group" ? "group" : "owner";
  const approvalTimeoutMs =
    value.approvalTimeoutMs === undefined
      ? 7_200_000
      : parseMinInt(value.approvalTimeoutMs, `node '${nodeId}'.hitl.approvalTimeoutMs`, 1_000);

  if (!enabled) {
    return {
      enabled: false,
      highRiskTools: [],
      approvalTarget,
      approvalTimeoutMs,
    };
  }

  const highRiskTools = parseStringArray(value.highRiskTools, `node '${nodeId}'.hitl.highRiskTools`);
  if (highRiskTools.length === 0) {
    throw new Error(`Workflow node '${nodeId}' hitl.highRiskTools cannot be empty when hitl.enabled=true.`);
  }

  return {
    enabled,
    highRiskTools,
    approvalTarget,
    approvalTimeoutMs,
  };
}

function parseNode(value: unknown): NormalizedWorkflowNodeDefinition {
  if (!isObject(value)) {
    throw new Error("Workflow node must be an object.");
  }

  const id = parseString(value.id, "node.id");
  return {
    id,
    name: parseOptionalString(value.name),
    role: parseString(value.role, `node '${id}'.role`),
    skillNames: parseStringArray(value.skillNames, `node '${id}'.skillNames`, {
      defaultEmpty: true,
    }),
    taskPrompt: parseString(value.taskPrompt, `node '${id}'.taskPrompt`),
    dependsOn: parseStringArray(value.dependsOn, `node '${id}'.dependsOn`),
    outputKeys: parseStringArray(value.outputKeys, `node '${id}'.outputKeys`, {
      defaultEmpty: true,
    }),
    retry: parseRetry(value.retry, id),
    hitl: parseHitl(value.hitl, id),
  };
}

function parseExecution(value: unknown, nodeCount: number): WorkflowExecution {
  if (value === undefined) {
    return {
      mode: "serial",
      maxParallel: 1,
    };
  }

  if (!isObject(value)) {
    throw new Error("Workflow execution must be an object.");
  }

  const modeRaw = value.mode;
  const mode = modeRaw === "parallel" ? "parallel" : "serial";

  if (mode === "serial") {
    return {
      mode,
      maxParallel: 1,
    };
  }

  return {
    mode,
    maxParallel:
      value.maxParallel === undefined
        ? Math.max(1, nodeCount)
        : parsePositiveInt(value.maxParallel, "execution.maxParallel"),
  };
}

function extractInterpolationExpressions(taskPrompt: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = INTERPOLATION_PATTERN.exec(taskPrompt)) !== null) {
    const expr = match[1]?.trim();
    if (!expr) {
      continue;
    }
    out.push(expr);
  }
  return out;
}

function validateInterpolationReferences(definition: NormalizedWorkflowDefinition): void {
  const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
  for (const node of definition.nodes) {
    const expressions = extractInterpolationExpressions(node.taskPrompt);
    for (const expr of expressions) {
      const segments = expr.split(".").filter((segment) => segment.length > 0);
      if (segments.length < 2) {
        throw new Error(
          `Workflow node '${node.id}' has invalid interpolation '{{${expr}}}'. Use {{trigger.xxx}} or {{nodeId.key}}.`,
        );
      }

      const [prefix, key] = segments;
      if (prefix === "trigger") {
        continue;
      }

      const sourceNode = nodeById.get(prefix);
      if (!sourceNode) {
        throw new Error(
          `Workflow node '${node.id}' references unknown interpolation source node '${prefix}' in '{{${expr}}}'.`,
        );
      }
      if (!node.dependsOn.includes(prefix)) {
        throw new Error(
          `Workflow node '${node.id}' references '{{${expr}}}' but '${prefix}' is not listed in dependsOn.`,
        );
      }

      if (sourceNode.outputKeys.length === 0) {
        throw new Error(
          `Workflow node '${node.id}' references '{{${expr}}}', but source node '${prefix}' does not declare outputKeys. ` +
            `Declare '${prefix}'.outputKeys to include '${key}'.`,
        );
      }

      if (key === "output" && !sourceNode.outputKeys.includes("output")) {
        throw new Error(
          `Workflow node '${node.id}' uses '{{${expr}}}', but source node '${prefix}' does not declare outputKeys including 'output'. ` +
            `Use a concrete key like '{{${prefix}.summary}}' and declare it in '${prefix}'.outputKeys.`,
        );
      }

      if (sourceNode.outputKeys.length > 0 && !sourceNode.outputKeys.includes(key)) {
        throw new Error(
          `Workflow node '${node.id}' references '{{${expr}}}', but '${prefix}'.outputKeys does not include '${key}'.`,
        );
      }
    }
  }
}

export function topologicalSort(definition: NormalizedWorkflowDefinition): string[] {
  const nodes = definition.nodes;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeIds.has(dep)) {
        throw new Error(`Workflow node '${node.id}' depends on unknown node '${dep}'.`);
      }
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      outgoing.get(dep)?.push(node.id);
    }
  }

  const queue = nodes
    .map((node) => node.id)
    .filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    order.push(id);
    for (const next of outgoing.get(id) ?? []) {
      const nextDegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDegree);
      if (nextDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("Workflow graph must be a DAG (cycle detected).");
  }

  return order;
}

export function validateWorkflowDefinition(definition: WorkflowDefinition): void {
  parseWorkflowDefinition(definition);
}

export function parseWorkflowDefinition(input: unknown): NormalizedWorkflowDefinition {
  if (!isObject(input)) {
    throw new Error("Workflow definition must be an object.");
  }

  const id = parseString(input.id, "id");
  const trigger = isObject(input.trigger) ? input.trigger : null;
  if (!trigger || trigger.type !== "manual") {
    throw new Error("Workflow trigger.type must be 'manual'.");
  }

  if (!Array.isArray(input.nodes) || input.nodes.length === 0) {
    throw new Error("Workflow nodes must be a non-empty array.");
  }

  const nodes = input.nodes.map((node) => parseNode(node));
  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new Error(`Workflow node id '${node.id}' is duplicated.`);
    }
    seen.add(node.id);
  }

  const normalized: NormalizedWorkflowDefinition = {
    id,
    name: parseOptionalString(input.name),
    trigger: {
      type: "manual",
    },
    execution: parseExecution(input.execution, nodes.length),
    nodes,
  };

  topologicalSort(normalized);
  validateInterpolationReferences(normalized);
  return normalized;
}
