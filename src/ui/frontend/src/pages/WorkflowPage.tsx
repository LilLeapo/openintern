import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { StudioData } from "../studio/useStudioData";
import type { ExecutableWorkflowDefinition, ExecutableWorkflowNode } from "../studio/types";

interface WorkflowPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

function parseEditorDefinition(text: string): {
  definition: ExecutableWorkflowDefinition | null;
  error: string | null;
} {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {
        definition: null,
        error: "Workflow JSON 必须是对象。",
      };
    }

    const candidate = parsed as Partial<ExecutableWorkflowDefinition>;
    if (!Array.isArray(candidate.nodes)) {
      return {
        definition: null,
        error: "Workflow JSON 必须包含 nodes 数组。",
      };
    }

    const definition: ExecutableWorkflowDefinition = {
      id: typeof candidate.id === "string" ? candidate.id : "wf_example",
      name: typeof candidate.name === "string" ? candidate.name : undefined,
      trigger:
        candidate.trigger && candidate.trigger.type === "manual"
          ? { type: "manual" }
          : {
              type: "manual",
            },
      execution:
        candidate.execution && typeof candidate.execution === "object"
          ? {
              mode:
                candidate.execution.mode === "parallel" || candidate.execution.mode === "serial"
                  ? candidate.execution.mode
                  : undefined,
              maxParallel:
                typeof candidate.execution.maxParallel === "number"
                  ? Math.max(1, Math.floor(candidate.execution.maxParallel))
                  : undefined,
            }
          : undefined,
      nodes: candidate.nodes.map((item, index) => {
        const node = item as Partial<ExecutableWorkflowNode>;
        return {
          id: typeof node.id === "string" ? node.id : `node_${index + 1}`,
          name: typeof node.name === "string" ? node.name : undefined,
          role: typeof node.role === "string" ? node.role : "scientist",
          taskPrompt: typeof node.taskPrompt === "string" ? node.taskPrompt : "",
          dependsOn: Array.isArray(node.dependsOn)
            ? node.dependsOn
                .map((dep) => (typeof dep === "string" ? dep.trim() : ""))
                .filter((dep) => dep.length > 0)
            : [],
          skillNames: Array.isArray(node.skillNames)
            ? node.skillNames.filter((skill): skill is string => typeof skill === "string")
            : [],
          outputKeys: Array.isArray(node.outputKeys)
            ? node.outputKeys.filter((key): key is string => typeof key === "string")
            : [],
          retry:
            node.retry && typeof node.retry === "object"
              ? {
                  maxAttempts:
                    typeof node.retry.maxAttempts === "number"
                      ? Math.max(1, Math.floor(node.retry.maxAttempts))
                      : 1,
                  backoffMs:
                    typeof node.retry.backoffMs === "number"
                      ? Math.max(0, Math.floor(node.retry.backoffMs))
                      : 0,
                }
              : undefined,
          hitl:
            node.hitl && typeof node.hitl === "object"
              ? {
                  enabled: node.hitl.enabled === true,
                  highRiskTools: Array.isArray(node.hitl.highRiskTools)
                    ? node.hitl.highRiskTools
                        .map((tool) => (typeof tool === "string" ? tool.trim() : ""))
                        .filter((tool) => tool.length > 0)
                    : [],
                  approvalTarget: node.hitl.approvalTarget === "group" ? "group" : "owner",
                  approvalTimeoutMs:
                    typeof node.hitl.approvalTimeoutMs === "number"
                      ? Math.max(1_000, Math.floor(node.hitl.approvalTimeoutMs))
                      : undefined,
                }
              : {
                  enabled: false,
                  highRiskTools: [],
                },
        };
      }),
    };

    return {
      definition,
      error: null,
    };
  } catch (error) {
    return {
      definition: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toJson(definition: ExecutableWorkflowDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

interface GraphNodePlacement {
  id: string;
  node: ExecutableWorkflowNode;
  x: number;
  y: number;
}

interface GraphEdgePlacement {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function buildGraphLayout(definition: ExecutableWorkflowDefinition | null): {
  nodes: GraphNodePlacement[];
  edges: GraphEdgePlacement[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
} {
  const nodeWidth = 250;
  const nodeHeight = 120;
  const gapX = 150;
  const gapY = 64;
  const padding = 36;

  if (!definition || definition.nodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: 980,
      height: 460,
      nodeWidth,
      nodeHeight,
    };
  }

  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const depthMemo = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (nodeId: string): number => {
    const cached = depthMemo.get(nodeId);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(nodeId)) {
      return 0;
    }

    const node = byId.get(nodeId);
    if (!node) {
      return 0;
    }

    visiting.add(nodeId);
    let depth = 0;
    for (const depId of node.dependsOn) {
      if (!byId.has(depId)) {
        continue;
      }
      depth = Math.max(depth, depthOf(depId) + 1);
    }
    visiting.delete(nodeId);
    depthMemo.set(nodeId, depth);
    return depth;
  };

  const layers = new Map<number, ExecutableWorkflowNode[]>();
  for (const node of definition.nodes) {
    const depth = depthOf(node.id);
    const items = layers.get(depth) ?? [];
    items.push(node);
    layers.set(depth, items);
  }

  const layerIds = Array.from(layers.keys()).sort((a, b) => a - b);
  const maxRows = Math.max(...Array.from(layers.values()).map((items) => items.length));
  const width =
    padding * 2 + layerIds.length * nodeWidth + Math.max(0, layerIds.length - 1) * gapX;
  const height = padding * 2 + maxRows * nodeHeight + Math.max(0, maxRows - 1) * gapY;

  const nodes: GraphNodePlacement[] = [];
  for (const layerId of layerIds) {
    const items = layers.get(layerId) ?? [];
    items.sort((a, b) => a.id.localeCompare(b.id));

    const x = padding + layerId * (nodeWidth + gapX);
    const layerHeight = items.length * nodeHeight + Math.max(0, items.length - 1) * gapY;
    const offsetY = Math.max(padding, Math.floor((height - layerHeight) / 2));

    for (let index = 0; index < items.length; index += 1) {
      nodes.push({
        id: items[index]?.id ?? "",
        node: items[index] as ExecutableWorkflowNode,
        x,
        y: offsetY + index * (nodeHeight + gapY),
      });
    }
  }

  const pointById = new Map(nodes.map((item) => [item.id, item]));
  const edges: GraphEdgePlacement[] = [];

  for (const point of nodes) {
    for (const depId of point.node.dependsOn) {
      const from = pointById.get(depId);
      if (!from) {
        continue;
      }
      edges.push({
        key: `${depId}->${point.id}`,
        x1: from.x + nodeWidth,
        y1: from.y + nodeHeight / 2,
        x2: point.x,
        y2: point.y + nodeHeight / 2,
      });
    }
  }

  return {
    nodes,
    edges,
    width: Math.max(width, 980),
    height: Math.max(height, 460),
    nodeWidth,
    nodeHeight,
  };
}

export function WorkflowPage({ studio, notify }: WorkflowPageProps) {
  const [searchParams] = useSearchParams();
  const [selectedWorkflowRef, setSelectedWorkflowRef] = useState<string>("editor");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [publishWorkflowId, setPublishWorkflowId] = useState("");
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [syncSelectionAfterSave, setSyncSelectionAfterSave] = useState(false);

  const {
    roles,
    runtimeAvailable,
    runtimeInitError,
    draftDefs,
    publishedDefs,
    selectedDraftId,
    setSelectedDraftId,
    workflowJson,
    setWorkflowJson,
    loadDraftToEditor,
    loadPublishedToEditor,
    saveDraft,
    publishDraft,
    startRunFromEditor,
    freshness,
    refreshAll,
  } = studio;

  const draftFromQuery = searchParams.get("draft")?.trim() ?? "";

  useEffect(() => {
    if (!draftFromQuery) {
      return;
    }
    setSelectedWorkflowRef(`draft:${draftFromQuery}`);
    void loadDraftToEditor(draftFromQuery).catch((error) => {
      notify(error instanceof Error ? error.message : String(error), "error");
    });
  }, [draftFromQuery, loadDraftToEditor, notify]);

  useEffect(() => {
    if (!syncSelectionAfterSave || !selectedDraftId) {
      return;
    }
    setSelectedWorkflowRef(`draft:${selectedDraftId}`);
    setSyncSelectionAfterSave(false);
  }, [selectedDraftId, syncSelectionAfterSave]);

  const parsedEditor = useMemo(() => parseEditorDefinition(workflowJson), [workflowJson]);
  const editorDefinition = parsedEditor.definition;
  const graphLayout = useMemo(() => buildGraphLayout(editorDefinition), [editorDefinition]);

  const selectedNodeIndex = useMemo(() => {
    if (!editorDefinition || !selectedNodeId) {
      return -1;
    }
    return editorDefinition.nodes.findIndex((node) => node.id === selectedNodeId);
  }, [editorDefinition, selectedNodeId]);

  const selectedNode =
    editorDefinition && selectedNodeIndex >= 0 ? editorDefinition.nodes[selectedNodeIndex] ?? null : null;

  useEffect(() => {
    if (!editorDefinition || editorDefinition.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (!selectedNodeId || !editorDefinition.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(editorDefinition.nodes[0]?.id ?? null);
    }
  }, [editorDefinition, selectedNodeId]);

  const updateDefinition = (updater: (definition: ExecutableWorkflowDefinition) => ExecutableWorkflowDefinition) => {
    if (!editorDefinition) {
      notify("当前 JSON 非法，无法进行图形化编辑。", "error");
      return;
    }
    const next = updater(structuredClone(editorDefinition));
    setWorkflowJson(toJson(next));
  };

  const updateSelectedNode = (updater: (node: ExecutableWorkflowNode) => ExecutableWorkflowNode) => {
    if (selectedNodeIndex < 0) {
      notify("请先选择一个节点。", "error");
      return;
    }
    updateDefinition((definition) => ({
      ...definition,
      nodes: definition.nodes.map((node, index) =>
        index === selectedNodeIndex ? updater(node) : node,
      ),
    }));
  };

  const onLoadWorkflowRef = async (value: string) => {
    setSelectedWorkflowRef(value);

    if (value === "editor") {
      return;
    }

    try {
      if (value.startsWith("draft:")) {
        const draftId = value.slice("draft:".length);
        setSelectedDraftId(draftId || null);
        await loadDraftToEditor(draftId);
        notify(`已加载 draft ${draftId}`);
        return;
      }

      if (value.startsWith("published:")) {
        const workflowId = value.slice("published:".length);
        setSelectedDraftId(null);
        await loadPublishedToEditor(workflowId);
        notify(`已加载 published ${workflowId}`);
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onSaveDraft = async () => {
    try {
      if (!selectedDraftId) {
        setSyncSelectionAfterSave(true);
      }
      await saveDraft(selectedDraftId);
      notify(selectedDraftId ? "Draft 已更新" : "Draft 已创建");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onPublish = async () => {
    if (!selectedDraftId) {
      notify("请先保存为 Draft，再发布上线。", "error");
      return;
    }

    try {
      await publishDraft(selectedDraftId, publishWorkflowId.trim() || undefined);
      notify("发布成功");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onRunEditor = async () => {
    try {
      await startRunFromEditor();
      notify("已触发模拟运行（当前图）");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onRefresh = async () => {
    try {
      await refreshAll();
      notify("已刷新 workflow 数据");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onAddNode = () => {
    if (!editorDefinition) {
      notify("当前 JSON 非法，无法新增节点。", "error");
      return;
    }

    const ids = new Set(editorDefinition.nodes.map((node) => node.id));
    let seq = editorDefinition.nodes.length + 1;
    let nextId = `node_${seq}`;
    while (ids.has(nextId)) {
      seq += 1;
      nextId = `node_${seq}`;
    }

    updateDefinition((definition) => ({
      ...definition,
      nodes: [
        ...definition.nodes,
        {
          id: nextId,
          role: roles[0]?.id ?? "scientist",
          taskPrompt: "Describe this node task and return JSON output.",
          dependsOn: [],
          hitl: {
            enabled: false,
            highRiskTools: [],
          },
        },
      ],
    }));
    setSelectedNodeId(nextId);
  };

  const onDeleteSelectedNode = () => {
    if (!editorDefinition || selectedNodeIndex < 0 || !selectedNode) {
      return;
    }

    const remaining = editorDefinition.nodes.filter((_, index) => index !== selectedNodeIndex);
    const nextSelected = remaining[Math.max(0, selectedNodeIndex - 1)]?.id ?? null;

    updateDefinition((definition) => ({
      ...definition,
      nodes: definition.nodes
        .filter((_, index) => index !== selectedNodeIndex)
        .map((node) => ({
          ...node,
          dependsOn: node.dependsOn.filter((depId) => depId !== selectedNode.id),
        })),
    }));

    setSelectedNodeId(nextSelected);
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <datalist id="workflow-role-options">
        {roles.map((role) => (
          <option key={role.id} value={role.id} />
        ))}
      </datalist>

      <div className="relative min-h-0 overflow-hidden rounded-2xl border border-slate-200 bg-white/90 shadow-panel">
        <div className="absolute inset-0 overflow-auto">
          {parsedEditor.error ? (
            <div className="p-6">
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                JSON 解析失败: {parsedEditor.error}
              </p>
            </div>
          ) : (
            <div
              className="relative canvas-bg"
              style={{
                width: graphLayout.width,
                height: graphLayout.height + 170,
                minHeight: 640,
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={graphLayout.width}
                height={graphLayout.height + 170}
                viewBox={`0 0 ${graphLayout.width} ${graphLayout.height + 170}`}
              >
                <defs>
                  <marker
                    id="wf-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
                  </marker>
                </defs>
                {graphLayout.edges.map((edge) => {
                  const y1 = edge.y1 + 150;
                  const y2 = edge.y2 + 150;
                  const midX = Math.floor((edge.x1 + edge.x2) / 2);
                  const path = `M ${edge.x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${edge.x2} ${y2}`;
                  return (
                    <path
                      key={edge.key}
                      d={path}
                      stroke="#64748b"
                      strokeWidth="2"
                      fill="none"
                      markerEnd="url(#wf-arrow)"
                    />
                  );
                })}
              </svg>

              {graphLayout.nodes.map((item) => {
                const isSelected = selectedNodeId === item.id;
                const isStart = item.node.dependsOn.length === 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedNodeId(item.id)}
                    className={`absolute rounded-xl border px-3 py-2 text-left shadow-sm transition ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                        : "border-slate-300 bg-white hover:border-emerald-400"
                    }`}
                    style={{
                      left: item.x,
                      top: item.y + 150,
                      width: graphLayout.nodeWidth,
                      height: graphLayout.nodeHeight,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-slate-800">{item.id}</p>
                      {isStart ? (
                        <span className="rounded-full border border-blue-300 bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                          START
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{item.node.name ?? "Unnamed node"}</p>
                    <p className="mt-1 text-xs text-slate-600">role: {item.node.role}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      dependsOn: {item.node.dependsOn.join(", ") || "-"}
                    </p>
                    {item.node.hitl?.enabled ? (
                      <p className="mt-1 text-[10px] text-amber-700">
                        HITL: {item.node.hitl.highRiskTools.join(", ") || "enabled"}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-4 top-4 z-20">
          <div className="pointer-events-auto rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex rounded-md bg-blue-100 px-2 py-1 text-[11px] font-bold tracking-wide text-blue-700">
                  SOP 编排
                </span>
                <h2 className="text-lg font-bold text-slate-800">
                  {editorDefinition?.name || editorDefinition?.id || "Workflow"}
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onAddNode}
                  className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-3 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
                >
                  新增节点
                </button>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-3 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
                >
                  {selectedDraftId ? "保存 Draft" : "另存为 Draft"}
                </button>
                <button
                  type="button"
                  onClick={onRunEditor}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  模拟运行
                </button>
                <button
                  type="button"
                  disabled={freshness === "stale" || !selectedDraftId}
                  onClick={() => {
                    void onPublish();
                  }}
                  className="rounded-xl border border-[#0d652d] bg-[#0d652d] px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-[#0a4a21] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  发布上线
                </button>
                <button
                  type="button"
                  onClick={() => setShowJsonEditor((prev) => !prev)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {showJsonEditor ? "隐藏 JSON" : "显示 JSON"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onRefresh();
                  }}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  刷新
                </button>
              </div>
            </div>

            <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px]">
              <label className="text-xs text-slate-600">
                选择 Workflow
                <select
                  value={selectedWorkflowRef}
                  onChange={(event) => {
                    void onLoadWorkflowRef(event.target.value);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="editor">当前编辑器（未保存）</option>
                  <optgroup label="Drafts">
                    {draftDefs.map((draft) => (
                      <option key={`draft:${draft.id}`} value={`draft:${draft.id}`}>
                        {draft.id}{draft.valid ? "" : " (invalid)"}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Published">
                    {publishedDefs.map((item) => (
                      <option key={`published:${item.id}`} value={`published:${item.id}`}>
                        {item.id}{item.valid ? "" : " (invalid)"}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>

              <label className="text-xs text-slate-600">
                发布 workflow_id（可选）
                <input
                  value={publishWorkflowId}
                  onChange={(event) => setPublishWorkflowId(event.target.value)}
                  placeholder={selectedDraftId ?? "wf_example"}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>
            </div>

            <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">
                runtime: {runtimeAvailable ? "available" : "unavailable"}
              </span>
              <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">
                freshness: {freshness}
              </span>
              <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5">
                selectedDraft: {selectedDraftId ?? "-"}
              </span>
              {runtimeInitError ? (
                <span className="rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-red-700">
                  {runtimeInitError}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {showJsonEditor ? (
          <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20">
            <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
              <h3 className="text-sm font-semibold">Workflow JSON</h3>
              <textarea
                rows={8}
                value={workflowJson}
                onChange={(event) => setWorkflowJson(event.target.value)}
                className="mt-2 w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs"
              />
            </div>
          </div>
        ) : null}
      </div>

      <aside className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-800">Workflow 设置</h3>
          <label className="mt-2 block text-xs text-slate-600">
            workflow id
            <input
              value={editorDefinition?.id ?? ""}
              onChange={(event) =>
                updateDefinition((definition) => ({
                  ...definition,
                  id: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="mt-2 block text-xs text-slate-600">
            workflow name
            <input
              value={editorDefinition?.name ?? ""}
              onChange={(event) =>
                updateDefinition((definition) => ({
                  ...definition,
                  name: event.target.value,
                }))
              }
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>
        </div>

        <h3 className="mt-3 text-base font-bold">配置节点</h3>
        {selectedNode ? (
          <p className="mt-1 text-sm text-slate-500">{selectedNode.id} · {selectedNode.role}</p>
        ) : (
          <p className="mt-1 text-sm text-slate-500">请先点击流程图中的节点。</p>
        )}

        {selectedNode ? (
          <div className="mt-3 space-y-2">
            <label className="text-xs text-slate-600">
              node id
              <input
                value={selectedNode.id}
                onChange={(event) => {
                  const nextId = event.target.value.trim();
                  if (!nextId) {
                    return;
                  }
                  if (
                    editorDefinition?.nodes.some(
                      (node, index) => index !== selectedNodeIndex && node.id === nextId,
                    )
                  ) {
                    notify(`节点 id '${nextId}' 已存在`, "error");
                    return;
                  }
                  updateDefinition((definition) => {
                    const oldId = definition.nodes[selectedNodeIndex]?.id ?? "";
                    const nextNodes = definition.nodes.map((node, index) => {
                      if (index === selectedNodeIndex) {
                        return {
                          ...node,
                          id: nextId,
                        };
                      }
                      return {
                        ...node,
                        dependsOn: Array.from(
                          new Set(node.dependsOn.map((dep) => (dep === oldId ? nextId : dep))),
                        ),
                      };
                    });
                    return {
                      ...definition,
                      nodes: nextNodes,
                    };
                  });
                  setSelectedNodeId(nextId);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              node name（可选）
              <input
                value={selectedNode.name ?? ""}
                onChange={(event) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    name: event.target.value || undefined,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              role
              <input
                list="workflow-role-options"
                value={selectedNode.role}
                onChange={(event) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    role: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-xs text-slate-600">
              taskPrompt
              <textarea
                rows={6}
                value={selectedNode.taskPrompt}
                onChange={(event) =>
                  updateSelectedNode((node) => ({
                    ...node,
                    taskPrompt: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <p className="text-xs font-semibold text-slate-700">dependsOn</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {editorDefinition?.nodes
                  .filter((node) => node.id !== selectedNode.id)
                  .map((candidate) => {
                    const checked = selectedNode.dependsOn.includes(candidate.id);
                    return (
                      <label
                        key={`${selectedNode.id}:dep:${candidate.id}`}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-1 text-[11px]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) =>
                            updateSelectedNode((node) => {
                              const set = new Set(node.dependsOn);
                              if (event.target.checked) {
                                set.add(candidate.id);
                              } else {
                                set.delete(candidate.id);
                              }
                              return {
                                ...node,
                                dependsOn: Array.from(set),
                              };
                            })
                          }
                        />
                        {candidate.id}
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedNode.hitl?.enabled === true}
                  onChange={(event) =>
                    updateSelectedNode((node) => ({
                      ...node,
                      hitl: {
                        enabled: event.target.checked,
                        highRiskTools: node.hitl?.highRiskTools ?? [],
                        approvalTarget: node.hitl?.approvalTarget ?? "owner",
                        approvalTimeoutMs: node.hitl?.approvalTimeoutMs,
                      },
                    }))
                  }
                />
                启用 HITL
              </label>

              {selectedNode.hitl?.enabled ? (
                <label className="mt-2 block text-xs text-slate-600">
                  highRiskTools（逗号分隔）
                  <input
                    value={selectedNode.hitl.highRiskTools.join(",")}
                    onChange={(event) =>
                      updateSelectedNode((node) => ({
                        ...node,
                        hitl: {
                          enabled: true,
                          highRiskTools: event.target.value
                            .split(",")
                            .map((tool) => tool.trim())
                            .filter((tool) => tool.length > 0),
                          approvalTarget: node.hitl?.approvalTarget ?? "owner",
                          approvalTimeoutMs: node.hitl?.approvalTimeoutMs,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onDeleteSelectedNode}
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
            >
              删除当前节点
            </button>
          </div>
        ) : null}
      </aside>
    </section>
  );
}
