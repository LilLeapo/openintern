import { FormEvent, useEffect, useMemo, useState } from "react";

import type { StudioData } from "../studio/useStudioData";
import { kindLabel } from "../studio/types";

interface WorkflowPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

interface AddNodeForm {
  kind: "trigger" | "agent" | "action";
  name: string;
  role: string;
  description: string;
}

interface EdgeForm {
  from: string;
  to: string;
}

interface NodeConfigForm {
  name: string;
  role: string;
  description: string;
  toolIds: string[];
}

export function WorkflowPage({ studio, notify }: WorkflowPageProps) {
  const {
    nodes,
    edges,
    roles,
    tools,
    selectedNode,
    selectedNodeId,
    setSelectedNodeId,
    toolById,
    edgePaths,
    addNode,
    addEdge,
    updateNode,
  } = studio;

  const [addNodeForm, setAddNodeForm] = useState<AddNodeForm>({
    kind: "trigger",
    name: "",
    role: "",
    description: "",
  });
  const [edgeForm, setEdgeForm] = useState<EdgeForm>({ from: "", to: "" });
  const [nodeConfig, setNodeConfig] = useState<NodeConfigForm | null>(null);

  useEffect(() => {
    if (roles.length > 0) {
      setAddNodeForm((prev) => ({ ...prev, role: prev.role || roles[0].id }));
    }
  }, [roles]);

  useEffect(() => {
    if (nodes.length > 0) {
      setEdgeForm((prev) => ({
        from: prev.from || nodes[0].id,
        to: prev.to || nodes[Math.min(1, nodes.length - 1)].id,
      }));
    }
  }, [nodes]);

  useEffect(() => {
    if (!selectedNode && nodes.length > 0 && !selectedNodeId) {
      const fallback = nodes.find((node) => node.kind === "agent")?.id ?? nodes[0].id;
      setSelectedNodeId(fallback);
    }
  }, [selectedNode, selectedNodeId, nodes, setSelectedNodeId]);

  useEffect(() => {
    if (!selectedNode) {
      setNodeConfig(null);
      return;
    }
    setNodeConfig({
      name: selectedNode.name,
      role: selectedNode.role ?? "",
      description: selectedNode.description,
      toolIds: selectedNode.toolIds,
    });
  }, [selectedNode]);

  const pendingApprovals = useMemo(
    () => studio.approvals.filter((approval) => approval.status === "pending"),
    [studio.approvals],
  );

  const onAddNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await addNode({
        kind: addNodeForm.kind,
        name: addNodeForm.name,
        role: addNodeForm.kind === "agent" ? addNodeForm.role : null,
        description: addNodeForm.description,
      });
      setAddNodeForm((prev) => ({ ...prev, name: "", description: "" }));
      notify("节点已创建");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onAddEdge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await addEdge(edgeForm);
      notify("连线已添加并通过 DAG 校验");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onSaveNodeConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedNode || !nodeConfig) {
      return;
    }

    try {
      await updateNode(selectedNode.id, {
        name: nodeConfig.name,
        role: nodeConfig.role || null,
        description: nodeConfig.description,
        toolIds: nodeConfig.toolIds,
      });
      notify("节点配置已保存");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
          <div>
            <h2 className="text-base font-bold">SOP 串联与 DAG 工作流编排</h2>
            <p className="mt-1 text-sm text-slate-500">通过连线定义 SOP 执行链，系统自动阻止形成环。</p>
          </div>
          <div className="flex gap-4 text-center text-xs text-slate-500">
            <div>
              <div>节点</div>
              <strong className="mt-1 block text-xl text-slate-800">{nodes.length}</strong>
            </div>
            <div>
              <div>连线</div>
              <strong className="mt-1 block text-xl text-slate-800">{edges.length}</strong>
            </div>
            <div>
              <div>待审批</div>
              <strong className="mt-1 block text-xl text-slate-800">{pendingApprovals.length}</strong>
            </div>
          </div>
        </div>

        <div className="relative min-h-[380px] flex-1 overflow-auto rounded-2xl border border-slate-200 bg-gradient-to-b from-[#f5f8f7] to-[#edf2f1] shadow-panel">
          <svg className="edge-layer absolute left-0 top-0" viewBox="0 0 1200 620" preserveAspectRatio="none">
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
                <path d="M0,0 L10,4 L0,8 z" fill="#a8b4b2" />
              </marker>
            </defs>
            {edgePaths.map((path) => (
              <path key={path.id} d={path.d} fill="none" stroke="#a8b4b2" strokeWidth="2" markerEnd="url(#arrow)" />
            ))}
          </svg>

          <div className="node-layer relative">
            {nodes.map((node) => {
              const hasRiskTool = node.toolIds.some((toolId) => toolById.get(toolId)?.riskLevel === "high");
              return (
                <article
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`absolute w-[250px] cursor-pointer rounded-2xl border bg-white p-3 shadow-md transition hover:-translate-y-0.5 hover:border-[#99b8aa] ${
                    selectedNodeId === node.id
                      ? "border-2 border-[#3c9660] shadow-lg shadow-[#227846]/20"
                      : "border-slate-200"
                  }`}
                  style={{ left: node.position.x, top: node.position.y }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-bold tracking-wide text-slate-500">{kindLabel[node.kind]}</div>
                      <div className="mt-1 text-sm font-bold text-slate-800">{node.name}</div>
                    </div>
                    {node.requiresApproval && hasRiskTool ? (
                      <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                        HITL
                      </span>
                    ) : null}
                  </div>

                  {node.role ? (
                    <span className="mt-2 inline-flex rounded-md bg-slate-100 px-2 py-1 font-mono text-[11px] text-slate-700">
                      {node.role}
                    </span>
                  ) : null}

                  <p className="mt-2 text-xs leading-relaxed text-slate-500">{node.description || "暂无描述"}</p>
                </article>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <form onSubmit={onAddNode} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
            <h3 className="mb-3 text-sm font-bold">新增节点</h3>
            <div className="space-y-2 text-xs text-slate-600">
              <label className="block">
                类型
                <select
                  value={addNodeForm.kind}
                  onChange={(event) =>
                    setAddNodeForm((prev) => ({ ...prev, kind: event.target.value as AddNodeForm["kind"] }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                >
                  <option value="trigger">Trigger</option>
                  <option value="agent">Sub-Agent</option>
                  <option value="action">Action</option>
                </select>
              </label>

              <label className="block">
                名称
                <input
                  value={addNodeForm.name}
                  onChange={(event) => setAddNodeForm((prev) => ({ ...prev, name: event.target.value }))}
                  required
                  placeholder="例如：Data Cleaner"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                角色（仅 Agent）
                <select
                  value={addNodeForm.role}
                  disabled={addNodeForm.kind !== "agent"}
                  onChange={(event) => setAddNodeForm((prev) => ({ ...prev, role: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm disabled:opacity-60"
                >
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.id}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                描述
                <input
                  value={addNodeForm.description}
                  onChange={(event) =>
                    setAddNodeForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                  placeholder="节点职责描述"
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <button
              type="submit"
              className="mt-3 rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
            >
              添加节点
            </button>
          </form>

          <form onSubmit={onAddEdge} className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
            <h3 className="mb-3 text-sm font-bold">新增连线</h3>
            <div className="space-y-2 text-xs text-slate-600">
              <label className="block">
                From
                <select
                  value={edgeForm.from}
                  onChange={(event) => setEdgeForm((prev) => ({ ...prev, from: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                To
                <select
                  value={edgeForm.to}
                  onChange={(event) => setEdgeForm((prev) => ({ ...prev, to: event.target.value }))}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button
              type="submit"
              className="mt-3 rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
            >
              添加边（DAG 校验）
            </button>
          </form>
        </div>
      </div>

      <aside className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="mb-3 text-sm font-bold">节点配置（工作流）</h2>
        {selectedNode && nodeConfig ? (
          <form onSubmit={onSaveNodeConfig} className="space-y-2 text-xs text-slate-600">
            <label className="block">
              节点名称
              <input
                value={nodeConfig.name}
                onChange={(event) => setNodeConfig({ ...nodeConfig, name: event.target.value })}
                required
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              节点类型
              <input
                value={selectedNode.kind}
                readOnly
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              绑定 Role
              <select
                disabled={selectedNode.kind !== "agent"}
                value={nodeConfig.role}
                onChange={(event) => setNodeConfig({ ...nodeConfig, role: event.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">(仅 Trigger/Action)</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.id}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              任务描述
              <textarea
                value={nodeConfig.description}
                onChange={(event) => setNodeConfig({ ...nodeConfig, description: event.target.value })}
                rows={3}
                className="mt-1 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              />
            </label>

            <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-2">
              <legend className="px-1 text-xs font-semibold text-slate-500">可用工具</legend>
              {selectedNode.kind !== "agent" ? (
                <p className="text-xs text-slate-500">Trigger/Action 节点无需绑定 Agent 工具。</p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-auto pr-1">
                  {tools.map((tool) => (
                    <label
                      key={tool.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2"
                    >
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="font-mono text-[11px]">{tool.name}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] ${
                            tool.riskLevel === "high"
                              ? "border-amber-300 bg-amber-100 text-amber-700"
                              : "border-emerald-300 bg-emerald-100 text-emerald-700"
                          }`}
                        >
                          {tool.riskLevel}
                        </span>
                        <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                          {tool.source}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={nodeConfig.toolIds.includes(tool.id)}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setNodeConfig((prev) =>
                              prev ? { ...prev, toolIds: [...new Set([...prev.toolIds, tool.id])] } : prev,
                            );
                            return;
                          }
                          setNodeConfig((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  toolIds: prev.toolIds.filter((toolId) => toolId !== tool.id),
                                }
                              : prev,
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>

            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              HITL 审批开关和审批队列已单独拆分到左侧导航的 “HITL” 页面。
            </p>

            <button
              type="submit"
              className="w-full rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
            >
              保存节点设置
            </button>
          </form>
        ) : (
          <p className="text-xs text-slate-500">请先在画布选择节点。</p>
        )}
      </aside>
    </section>
  );
}
