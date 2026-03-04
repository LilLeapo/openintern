import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type {
  ApprovalTarget,
  NodeKind,
  ToolRiskLevel,
  UiSnapshot,
  WorkflowNode,
} from "./types";

export interface AddNodeInput {
  kind: NodeKind;
  name: string;
  role: string | null;
  description: string;
}

export interface AddEdgeInput {
  from: string;
  to: string;
}

export interface UpdateNodeInput {
  name?: string;
  description?: string;
  role?: string | null;
  requiresApproval?: boolean;
  approvalTarget?: ApprovalTarget;
  toolIds?: string[];
}

export interface RegisterToolInput {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  inputSchema: string;
  scriptName?: string;
  scriptContent?: string;
}

export function useStudioData() {
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const nodes = snapshot?.workflow.nodes ?? [];
  const edges = snapshot?.workflow.edges ?? [];
  const roles = snapshot?.registry.roles ?? [];
  const tools = snapshot?.registry.tools ?? [];
  const approvals = snapshot?.approvals ?? [];
  const traces = snapshot?.traces ?? [];

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const toolById = useMemo(() => new Map(tools.map((tool) => [tool.id, tool])), [tools]);

  const loadSnapshot = async (): Promise<UiSnapshot> => {
    const data = await api<UiSnapshot>("/api/state");
    setSnapshot(data);

    const fallbackNodeId =
      data.workflow.nodes.find((node) => node.kind === "agent")?.id ??
      data.workflow.nodes[0]?.id ??
      null;

    setSelectedNodeId((prev) =>
      prev && data.workflow.nodes.some((node) => node.id === prev) ? prev : fallbackNodeId,
    );

    return data;
  };

  useEffect(() => {
    void loadSnapshot().catch(() => {
      // Errors are surfaced by action handlers; initial load failure keeps empty UI.
    });
  }, []);

  const refresh = async (): Promise<void> => {
    await loadSnapshot();
  };

  const addNode = async (input: AddNodeInput): Promise<void> => {
    await api<UiSnapshot>("/api/workflow/nodes", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await refresh();
  };

  const addEdge = async (input: AddEdgeInput): Promise<void> => {
    await api<UiSnapshot>("/api/workflow/edges", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await refresh();
  };

  const updateNode = async (nodeId: string, input: UpdateNodeInput): Promise<void> => {
    await api<UiSnapshot>(`/api/workflow/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    await refresh();
  };

  const startRun = async (): Promise<void> => {
    await api<UiSnapshot>("/api/runs/start", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await refresh();
  };

  const approve = async (approvalId: string): Promise<void> => {
    await api<UiSnapshot>(`/api/approvals/${approvalId}/approve`, {
      method: "POST",
      body: JSON.stringify({ approver: "researcher" }),
    });
    await refresh();
  };

  const registerTool = async (input: RegisterToolInput): Promise<void> => {
    await api<UiSnapshot>("/api/registry/tools", {
      method: "POST",
      body: JSON.stringify(input),
    });
    await refresh();
  };

  const edgePaths = useMemo(() => {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    return edges
      .map((edge) => {
        const from = nodeMap.get(edge.from);
        const to = nodeMap.get(edge.to);
        if (!from || !to) {
          return null;
        }

        const fromX = from.position.x + 250;
        const fromY = from.position.y + 66;
        const toX = to.position.x;
        const toY = to.position.y + 66;
        const curve = Math.max(80, (toX - fromX) * 0.4);

        return {
          id: edge.id,
          d: `M ${fromX} ${fromY} C ${fromX + curve} ${fromY}, ${toX - curve} ${toY}, ${toX} ${toY}`,
        };
      })
      .filter((item): item is { id: string; d: string } => item !== null);
  }, [nodes, edges]);

  const highRiskAgentNodes = useMemo(() => {
    const byId = new Map(tools.map((tool) => [tool.id, tool]));
    return nodes
      .filter((node) => node.kind === "agent")
      .map((node) => {
        const hasHighRiskTool = node.toolIds.some((toolId) => byId.get(toolId)?.riskLevel === "high");
        return {
          node,
          hasHighRiskTool,
        };
      });
  }, [nodes, tools]);

  return {
    snapshot,
    nodes,
    edges,
    roles,
    tools,
    approvals,
    traces,
    selectedNode,
    selectedNodeId,
    setSelectedNodeId,
    toolById,
    edgePaths,
    highRiskAgentNodes,
    refresh,
    addNode,
    addEdge,
    updateNode,
    startRun,
    approve,
    registerTool,
  };
}

export type StudioData = ReturnType<typeof useStudioData>;
export type AgentNode = WorkflowNode;
