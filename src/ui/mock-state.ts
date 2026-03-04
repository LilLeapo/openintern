import { randomUUID } from "node:crypto";

import { MessageBus } from "../bus/message-bus.js";
import type { AppConfig } from "../config/schema.js";

export type NodeKind = "trigger" | "agent" | "action";
export type ToolRiskLevel = "low" | "high";
export type ApprovalTarget = "owner" | "group";
export type RunStatus = "idle" | "running" | "paused" | "completed";

export interface WorkflowNode {
  id: string;
  name: string;
  kind: NodeKind;
  description: string;
  role: string | null;
  requiresApproval: boolean;
  approvalTarget: ApprovalTarget;
  toolIds: string[];
  position: {
    x: number;
    y: number;
  };
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "registry";
  riskLevel: ToolRiskLevel;
  scriptName: string | null;
  scriptPreview: string | null;
  inputSchema: string;
}

export interface RoleSummary {
  id: string;
  systemPrompt: string;
  allowedTools: string[];
}

export interface ApprovalRequest {
  id: string;
  nodeId: string;
  nodeName: string;
  toolId: string;
  target: ApprovalTarget;
  status: "pending" | "approved";
  requestedAt: string;
  approvedAt: string | null;
  parameters: {
    voltageV: number;
    flowSccm: number;
  };
}

export interface TraceEvent {
  id: string;
  runId: string;
  timestamp: string;
  type: "info" | "llm" | "tool_call" | "tool_result" | "error" | "guard" | "approval";
  title: string;
  details: string;
  status: "ok" | "pending" | "failed";
}

export interface RunViewState {
  id: string | null;
  status: RunStatus;
  currentNodeId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  pauseReason: string | null;
  pendingApprovalId: string | null;
}

export interface UiSnapshot {
  workflow: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
  registry: {
    tools: ToolDefinition[];
    roles: RoleSummary[];
  };
  approvals: ApprovalRequest[];
  traces: TraceEvent[];
  run: RunViewState;
}

export interface AddNodeInput {
  kind: NodeKind;
  name: string;
  description?: string;
  role?: string | null;
}

export interface UpdateNodeInput {
  name?: string;
  description?: string;
  role?: string | null;
  requiresApproval?: boolean;
  approvalTarget?: ApprovalTarget;
  toolIds?: string[];
}

export interface AddEdgeInput {
  from: string;
  to: string;
}

export interface RegisterToolInput {
  name: string;
  description: string;
  inputSchema: string;
  riskLevel: ToolRiskLevel;
  scriptName?: string;
  scriptContent?: string;
}

interface RunRuntimeState extends RunViewState {
  plan: string[];
  cursor: number;
}

const HIGH_RISK_KEYWORDS = ["exec", "overwrite", "delete", "control"]; 

const TOOL_DESCRIPTIONS: Record<string, string> = {
  read_file: "读取工作区文件内容",
  write_file: "写入新文件或覆盖已有文件",
  edit_file: "按补丁方式修改文件",
  list_dir: "查看目录结构",
  exec: "执行终端命令或硬件控制脚本",
  message: "发送消息到外部通道",
  web_search: "联网检索",
  web_fetch: "抓取网页正文",
  spawn: "创建子 Agent 任务",
  memory_retrieve: "读取长期记忆",
  memory_save: "保存长期记忆",
  memory_delete: "清理指定记忆范围",
  scoped_memory_retrieve: "按 scope 检索记忆",
};

function nowIso(): string {
  return new Date().toISOString();
}

function mapRoleCatalog(config: AppConfig): RoleSummary[] {
  return Object.entries(config.roles).map(([id, role]) => ({
    id,
    systemPrompt: role.systemPrompt,
    allowedTools: role.allowedTools,
  }));
}

function inferRisk(toolId: string): ToolRiskLevel {
  const normalized = toolId.toLowerCase();
  if (HIGH_RISK_KEYWORDS.some((item) => normalized.includes(item))) {
    return "high";
  }
  return "low";
}

function topoSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const ids = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const id of ids) {
    indegree.set(id, 0);
    outgoing.set(id, []);
  }

  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      throw new Error("DAG 包含不存在的节点引用");
    }
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    const fromOutgoing = outgoing.get(edge.from);
    if (fromOutgoing) {
      fromOutgoing.push(edge.to);
    }
  }

  const queue = Array.from(ids).filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) {
      break;
    }
    order.push(id);
    const neighbors = outgoing.get(id) ?? [];
    for (const next of neighbors) {
      const current = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, current);
      if (current === 0) {
        queue.push(next);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new Error("该连线会形成环，SOP 需要保持 DAG（有向无环图）");
  }

  return order;
}

function clampText(text: string, max = 4000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n...`; 
}

export class UiMockState {
  private readonly bus = new MessageBus();

  private readonly roles: RoleSummary[];
  private readonly roleById: Map<string, RoleSummary>;

  private nodes: WorkflowNode[];
  private edges: WorkflowEdge[];
  private tools: ToolDefinition[];
  private approvals: ApprovalRequest[];
  private traces: TraceEvent[];
  private run: RunRuntimeState;

  constructor(config: AppConfig) {
    this.roles = mapRoleCatalog(config);
    this.roleById = new Map(this.roles.map((role) => [role.id, role]));

    this.tools = this.createInitialTools();
    this.nodes = [
      {
        id: "node_trigger_upload",
        kind: "trigger",
        name: "飞书群文档上传",
        description: "监听群文档上传并拉取最新实验 CSV。",
        role: null,
        requiresApproval: false,
        approvalTarget: "owner",
        toolIds: [],
        position: { x: 80, y: 80 },
      },
      {
        id: "node_agent_scientist",
        kind: "agent",
        name: "Scientist 模型推演",
        description: "运行 PINN 推演并产出建议参数。",
        role: this.roleById.has("scientist") ? "scientist" : this.roles[0]?.id ?? null,
        requiresApproval: true,
        approvalTarget: "group",
        toolIds: ["memory_retrieve", "exec"],
        position: { x: 420, y: 190 },
      },
      {
        id: "node_action_callback",
        kind: "action",
        name: "飞书群消息回调",
        description: "发送分析结果 Markdown 和图表到群聊。",
        role: null,
        requiresApproval: false,
        approvalTarget: "owner",
        toolIds: ["message"],
        position: { x: 760, y: 80 },
      },
    ];

    this.edges = [
      {
        id: "edge_trigger_to_scientist",
        from: "node_trigger_upload",
        to: "node_agent_scientist",
      },
      {
        id: "edge_scientist_to_callback",
        from: "node_agent_scientist",
        to: "node_action_callback",
      },
    ];

    this.approvals = [];
    this.traces = [
      {
        id: `trace_${randomUUID()}`,
        runId: "bootstrap",
        timestamp: nowIso(),
        type: "info",
        title: "Workflow Studio 初始化完成",
        details: "当前为前端联调模式：流程、审批和轨迹由 mock API 驱动。",
        status: "ok",
      },
    ];

    this.run = {
      id: null,
      status: "idle",
      currentNodeId: null,
      startedAt: null,
      endedAt: null,
      pauseReason: null,
      pendingApprovalId: null,
      plan: [],
      cursor: 0,
    };
  }

  getSnapshot(): UiSnapshot {
    return {
      workflow: {
        nodes: structuredClone(this.nodes),
        edges: structuredClone(this.edges),
      },
      registry: {
        tools: structuredClone(this.tools),
        roles: structuredClone(this.roles),
      },
      approvals: structuredClone(this.approvals),
      traces: structuredClone(this.traces),
      run: this.getRunView(),
    };
  }

  addNode(input: AddNodeInput): WorkflowNode {
    const name = input.name.trim();
    if (!name) {
      throw new Error("节点名称不能为空");
    }

    const role = input.kind === "agent" ? this.validateRole(input.role) : null;
    const index = this.nodes.length;
    const node: WorkflowNode = {
      id: `node_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      kind: input.kind,
      name,
      description: input.description?.trim() || "",
      role,
      requiresApproval: false,
      approvalTarget: "owner",
      toolIds: role ? this.defaultToolsForRole(role).slice(0, 2) : [],
      position: {
        x: 80 + (index % 3) * 320,
        y: 80 + Math.floor(index / 3) * 170,
      },
    };
    this.nodes.push(node);
    this.pushTrace({
      type: "info",
      title: `新增节点: ${node.name}`,
      details: `kind=${node.kind}, role=${node.role ?? "none"}`,
      status: "ok",
    });
    return structuredClone(node);
  }

  updateNode(nodeId: string, patch: UpdateNodeInput): WorkflowNode {
    const node = this.nodes.find((item) => item.id === nodeId);
    if (!node) {
      throw new Error("节点不存在");
    }

    if (typeof patch.name === "string") {
      const nextName = patch.name.trim();
      if (!nextName) {
        throw new Error("节点名称不能为空");
      }
      node.name = nextName;
    }
    if (typeof patch.description === "string") {
      node.description = patch.description.trim();
    }
    if (Object.hasOwn(patch, "requiresApproval") && typeof patch.requiresApproval === "boolean") {
      node.requiresApproval = patch.requiresApproval;
    }
    if (patch.approvalTarget) {
      node.approvalTarget = patch.approvalTarget;
    }

    if (node.kind === "agent") {
      if (Object.hasOwn(patch, "role")) {
        node.role = this.validateRole(patch.role);
      }
      if (patch.toolIds) {
        const toolIds = patch.toolIds.filter((id) => this.tools.some((tool) => tool.id === id));
        node.toolIds = Array.from(new Set(toolIds));
      }
    }

    this.pushTrace({
      type: "info",
      title: `节点已更新: ${node.name}`,
      details: "配置变更已保存到 Workflow Studio mock 存储。",
      status: "ok",
    });

    return structuredClone(node);
  }

  addEdge(input: AddEdgeInput): WorkflowEdge {
    if (input.from === input.to) {
      throw new Error("不能将节点连接到自身");
    }
    if (!this.nodes.some((node) => node.id === input.from) || !this.nodes.some((node) => node.id === input.to)) {
      throw new Error("连线节点不存在");
    }
    if (this.edges.some((edge) => edge.from === input.from && edge.to === input.to)) {
      throw new Error("该连线已存在");
    }

    const candidate: WorkflowEdge = {
      id: `edge_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      from: input.from,
      to: input.to,
    };

    topoSort(this.nodes, [...this.edges, candidate]);
    this.edges.push(candidate);
    this.pushTrace({
      type: "info",
      title: "新增 SOP 连线",
      details: `${input.from} -> ${input.to}`,
      status: "ok",
    });
    return structuredClone(candidate);
  }

  registerTool(input: RegisterToolInput): ToolDefinition {
    const name = input.name.trim();
    if (!name) {
      throw new Error("工具名称不能为空");
    }

    const schema = input.inputSchema.trim();
    if (!schema) {
      throw new Error("JSON Schema 不能为空");
    }

    try {
      JSON.parse(schema);
    } catch {
      throw new Error("JSON Schema 不是合法 JSON");
    }

    const tool: ToolDefinition = {
      id: `registry_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      name,
      description: input.description.trim() || "无描述",
      source: "registry",
      riskLevel: input.riskLevel,
      scriptName: input.scriptName?.trim() || null,
      scriptPreview: input.scriptContent ? clampText(input.scriptContent.trim(), 800) : null,
      inputSchema: schema,
    };

    this.tools.push(tool);
    this.pushTrace({
      type: "info",
      title: `注册工具: ${tool.name}`,
      details: `risk=${tool.riskLevel}, source=registry`,
      status: "ok",
    });

    return structuredClone(tool);
  }

  startRun(): RunViewState {
    if (this.run.status === "running" || this.run.status === "paused") {
      throw new Error("当前已有运行中的流程");
    }

    const plan = topoSort(this.nodes, this.edges);
    const runId = `run_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
    this.run = {
      id: runId,
      status: "running",
      currentNodeId: null,
      startedAt: nowIso(),
      endedAt: null,
      pauseReason: null,
      pendingApprovalId: null,
      plan,
      cursor: 0,
    };

    this.pushTrace({
      runId,
      type: "info",
      title: "SOP 执行启动",
      details: `执行顺序: ${plan.join(" -> ")}`,
      status: "ok",
    });

    this.executePlan();
    return this.getRunView();
  }

  async approve(approvalId: string, approver = "researcher"): Promise<RunViewState> {
    const approval = this.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      throw new Error("审批单不存在");
    }
    if (approval.status !== "pending") {
      throw new Error("审批单已处理");
    }

    if (this.run.status !== "paused" || this.run.pendingApprovalId !== approvalId || !this.run.id) {
      throw new Error("当前没有可恢复的挂起运行");
    }

    approval.status = "approved";
    approval.approvedAt = nowIso();

    this.pushTrace({
      runId: this.run.id,
      type: "approval",
      title: "HITL 审批已通过",
      details: `approver=${approver}, 参数=[电压 ${approval.parameters.voltageV}V, 流量 ${approval.parameters.flowSccm}sccm]`,
      status: "ok",
    });

    await this.bus.publishInbound({
      channel: "hitl",
      senderId: approver,
      chatId: approval.target,
      content: `approval.granted:${approval.id}`,
      metadata: {
        runId: this.run.id,
        nodeId: approval.nodeId,
        toolId: approval.toolId,
      },
    });

    this.pushTrace({
      runId: this.run.id,
      type: "info",
      title: "Message Bus 已唤醒子 Agent",
      details: `publishInbound(channel=hitl, content=approval.granted:${approval.id})`,
      status: "ok",
    });

    this.run.status = "running";
    this.run.pauseReason = null;
    this.run.pendingApprovalId = null;
    this.executePlan({ approvedNodeId: approval.nodeId });
    return this.getRunView();
  }

  private executePlan(options?: { approvedNodeId?: string }): void {
    if (!this.run.id) {
      return;
    }

    const nodeById = new Map(this.nodes.map((node) => [node.id, node]));

    while (this.run.cursor < this.run.plan.length) {
      const nodeId = this.run.plan[this.run.cursor];
      const node = nodeById.get(nodeId);
      if (!node) {
        this.pushTrace({
          runId: this.run.id,
          type: "error",
          title: "节点缺失",
          details: `nodeId=${nodeId} 在执行中不存在。`,
          status: "failed",
        });
        this.run.status = "completed";
        this.run.endedAt = nowIso();
        return;
      }

      this.run.currentNodeId = node.id;
      this.pushTrace({
        runId: this.run.id,
        type: "info",
        title: `进入节点: ${node.name}`,
        details: `kind=${node.kind}`,
        status: "ok",
      });

      if (node.kind === "trigger") {
        this.pushTrace({
          runId: this.run.id,
          type: "tool_result",
          title: "触发器事件捕获",
          details: "已获取最新上传的实验数据文件路径 Trigger.CSV_Path。",
          status: "ok",
        });
        this.run.cursor += 1;
        continue;
      }

      if (node.kind === "action") {
        this.pushTrace({
          runId: this.run.id,
          type: "tool_call",
          title: "发送飞书回调",
          details: "向 CO2 研发组推送 Markdown 报告与图表。",
          status: "ok",
        });
        this.pushTrace({
          runId: this.run.id,
          type: "tool_result",
          title: "回调成功",
          details: "消息发送完成。",
          status: "ok",
        });
        this.run.cursor += 1;
        continue;
      }

      const role = node.role ? this.roleById.get(node.role) : null;
      const tools = node.toolIds.length > 0
        ? node.toolIds
        : this.defaultToolsForRole(node.role);

      this.pushTrace({
        runId: this.run.id,
        type: "llm",
        title: `${node.name} 收到主 Agent 指令`,
        details: `role=${node.role ?? "unknown"}\nprompt=分析 {{Trigger.CSV_Path}} 并输出下一组参数建议。`,
        status: "ok",
      });

      this.pushTrace({
        runId: this.run.id,
        type: "guard",
        title: "Iteration Guard 检查",
        details: `remaining_budget=${Math.max(0, 15 - this.run.cursor)}; allowed_tools=${role?.allowedTools.length ?? 0}`,
        status: "ok",
      });

      let paused = false;
      for (const toolId of tools) {
        const tool = this.tools.find((item) => item.id === toolId);
        if (!tool) {
          continue;
        }

        const requiresApproval =
          node.requiresApproval &&
          tool.riskLevel === "high" &&
          options?.approvedNodeId !== node.id;

        if (requiresApproval) {
          const approval = this.createApproval(node, toolId);
          this.run.status = "paused";
          this.run.pauseReason = `等待人工审批：${tool.name}`;
          this.run.pendingApprovalId = approval.id;
          this.pushTrace({
            runId: this.run.id,
            type: "approval",
            title: "HITL 审批请求已发送",
            details:
              `飞书 Interactive Card: 子 Agent 申请执行参数 [电压: ${approval.parameters.voltageV}V, 流量: ${approval.parameters.flowSccm}sccm]`,
            status: "pending",
          });
          paused = true;
          break;
        }

        this.pushTrace({
          runId: this.run.id,
          type: "tool_call",
          title: `调用工具: ${tool.name}`,
          details: `tool_id=${toolId}; risk=${tool.riskLevel}`,
          status: "ok",
        });

        this.pushTrace({
          runId: this.run.id,
          type: "tool_result",
          title: `${tool.name} 返回`,
          details: tool.riskLevel === "high"
            ? "执行通过审批，返回参数候选集。"
            : "工具返回成功。",
          status: "ok",
        });
      }

      if (paused) {
        return;
      }

      this.pushTrace({
        runId: this.run.id,
        type: "llm",
        title: `${node.name} 输出下一跳结果`,
        details: "已将结构化结果传递给下游节点。",
        status: "ok",
      });

      this.run.cursor += 1;
    }

    this.run.status = "completed";
    this.run.currentNodeId = null;
    this.run.endedAt = nowIso();
    this.run.pauseReason = null;
    this.run.pendingApprovalId = null;

    this.pushTrace({
      runId: this.run.id,
      type: "info",
      title: "SOP 流程执行完成",
      details: "所有节点执行完毕。",
      status: "ok",
    });
  }

  private createApproval(node: WorkflowNode, toolId: string): ApprovalRequest {
    const approval: ApprovalRequest = {
      id: `approval_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      nodeId: node.id,
      nodeName: node.name,
      toolId,
      target: node.approvalTarget,
      status: "pending",
      requestedAt: nowIso(),
      approvedAt: null,
      parameters: {
        voltageV: 3.2,
        flowSccm: 50,
      },
    };
    this.approvals.unshift(approval);
    return approval;
  }

  private pushTrace(
    input: Omit<TraceEvent, "id" | "timestamp" | "runId"> & { runId?: string },
  ): void {
    const runId = input.runId ?? this.run.id ?? "bootstrap";
    const event: TraceEvent = {
      id: `trace_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      runId,
      timestamp: nowIso(),
      type: input.type,
      title: input.title,
      details: input.details,
      status: input.status,
    };
    this.traces.unshift(event);
    if (this.traces.length > 200) {
      this.traces = this.traces.slice(0, 200);
    }
  }

  private createInitialTools(): ToolDefinition[] {
    const union = new Set<string>();
    for (const role of this.roles) {
      for (const toolId of role.allowedTools) {
        union.add(toolId);
      }
    }
    union.add("message");

    const tools = Array.from(union).map((toolId) => ({
      id: toolId,
      name: toolId,
      description: TOOL_DESCRIPTIONS[toolId] ?? "系统内置工具",
      source: "builtin" as const,
      riskLevel: inferRisk(toolId),
      scriptName: null,
      scriptPreview: null,
      inputSchema: JSON.stringify({ type: "object", properties: {} }, null, 2),
    }));

    tools.push({
      id: "overwrite_core_database",
      name: "overwrite_core_database",
      description: "覆写核心实验数据库（高危）",
      source: "builtin",
      riskLevel: "high",
      scriptName: null,
      scriptPreview: null,
      inputSchema: JSON.stringify(
        {
          type: "object",
          required: ["dataset", "reason"],
          properties: {
            dataset: { type: "string" },
            reason: { type: "string" },
          },
        },
        null,
        2,
      ),
    });

    return tools;
  }

  private validateRole(role: string | null | undefined): string {
    if (!role) {
      throw new Error("Agent 节点必须绑定 role");
    }
    if (!this.roleById.has(role)) {
      throw new Error(`未知 role: ${role}`);
    }
    return role;
  }

  private defaultToolsForRole(roleId: string | null): string[] {
    if (!roleId) {
      return [];
    }
    const role = this.roleById.get(roleId);
    if (!role) {
      return [];
    }
    return role.allowedTools.filter((toolId) => this.tools.some((tool) => tool.id === toolId));
  }

  private getRunView(): RunViewState {
    return {
      id: this.run.id,
      status: this.run.status,
      currentNodeId: this.run.currentNodeId,
      startedAt: this.run.startedAt,
      endedAt: this.run.endedAt,
      pauseReason: this.run.pauseReason,
      pendingApprovalId: this.run.pendingApprovalId,
    };
  }
}
