import { useMemo, useState } from "react";

import type { StudioData } from "../studio/useStudioData";
import type { EditableRoleInput, RoleSummary } from "../studio/types";

interface RegistryPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

export function RegistryPage({ studio, notify }: RegistryPageProps) {
  const { roles, tools, skills, createRole, optimizeRole, refreshAll } = studio;

  const [roleId, setRoleId] = useState("role_custom");
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a domain specialist. Think carefully, then return concise structured outputs.",
  );
  const [memoryScope, setMemoryScope] = useState<"chat" | "papers">("chat");
  const [maxIterations, setMaxIterations] = useState(15);
  const [workspaceIsolation, setWorkspaceIsolation] = useState(false);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [optimizeInstruction, setOptimizeInstruction] = useState("");
  const [optimizing, setOptimizing] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  const roleIds = useMemo(() => new Set(roles.map((role) => role.id)), [roles]);

  const toggleTool = (toolId: string, checked: boolean) => {
    setSelectedTools((prev) => {
      const set = new Set(prev);
      if (checked) {
        set.add(toolId);
      } else {
        set.delete(toolId);
      }
      return Array.from(set);
    });
  };

  const resetEditor = () => {
    setRoleId("role_custom");
    setSystemPrompt(
      "You are a domain specialist. Think carefully, then return concise structured outputs.",
    );
    setSelectedTools([]);
    setMemoryScope("chat");
    setMaxIterations(15);
    setWorkspaceIsolation(false);
    setEditingRoleId(null);
  };

  const loadRoleToEditor = (role: RoleSummary) => {
    setRoleId(role.id);
    setSystemPrompt(role.systemPrompt);
    setSelectedTools(role.allowedTools);
    setMemoryScope(role.memoryScope);
    setMaxIterations(role.maxIterations);
    setWorkspaceIsolation(role.workspaceIsolation);
    setEditingRoleId(role.id);
  };

  const onSaveRole = async () => {
    try {
      const payload: EditableRoleInput = {
        id: roleId,
        systemPrompt,
        allowedTools: selectedTools,
        memoryScope,
        maxIterations,
        workspaceIsolation,
      };
      await createRole({
        ...payload,
      });
      setEditingRoleId(roleId);
      notify(roleIds.has(roleId) ? `角色 ${roleId} 已更新` : `角色 ${roleId} 已新增`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onOptimizeRole = async () => {
    setOptimizing(true);
    try {
      const optimized = await optimizeRole({
        instruction: optimizeInstruction,
        roleId,
        role: {
          id: roleId,
          systemPrompt,
          allowedTools: selectedTools,
          memoryScope,
          maxIterations,
          workspaceIsolation,
        },
      });
      setRoleId(optimized.id);
      setSystemPrompt(optimized.role.systemPrompt);
      setSelectedTools(optimized.role.allowedTools);
      setMemoryScope(optimized.role.memoryScope);
      setMaxIterations(optimized.role.maxIterations);
      setWorkspaceIsolation(optimized.role.workspaceIsolation);
      notify("LLM 已回填优化后的 role 配置");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setOptimizing(false);
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">Roles</h2>
          <button
            type="button"
            onClick={() => {
              void refreshAll()
                .then(() => notify("已刷新 catalog / roles"))
                .catch((error) => notify(error instanceof Error ? error.message : String(error), "error"));
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
          >
            刷新目录
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500">可手工新增/更新角色；保存后写入真实配置并立即可用于 workflow。</p>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Role Editor</h3>
            <div className="flex items-center gap-2">
              {editingRoleId ? (
                <span className="rounded-full border border-blue-300 bg-blue-100 px-2 py-0.5 text-[10px] text-blue-700">
                  editing: {editingRoleId}
                </span>
              ) : null}
              <button
                type="button"
                onClick={resetEditor}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                新建角色
              </button>
            </div>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-600">
              role id
              <input
                value={roleId}
                onChange={(event) => setRoleId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              memoryScope
              <select
                value={memoryScope}
                onChange={(event) => setMemoryScope(event.target.value === "papers" ? "papers" : "chat")}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="chat">chat</option>
                <option value="papers">papers</option>
              </select>
            </label>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <label className="text-xs text-slate-600">
              maxIterations
              <input
                type="number"
                min={1}
                value={maxIterations}
                onChange={(event) => setMaxIterations(Math.max(1, Number(event.target.value) || 1))}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              />
            </label>
            <label className="inline-flex items-center gap-2 pt-6 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={workspaceIsolation}
                onChange={(event) => setWorkspaceIsolation(event.target.checked)}
              />
              workspaceIsolation
            </label>
          </div>

          <label className="mt-2 block text-xs text-slate-600">
            systemPrompt
            <textarea
              rows={4}
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            />
          </label>

          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2">
            <p className="text-xs font-semibold text-slate-700">allowedTools</p>
            <div className="mt-1 flex max-h-40 flex-wrap gap-2 overflow-auto">
              {tools.map((tool) => {
                const checked = selectedTools.includes(tool.id);
                return (
                  <label
                    key={tool.id}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-[11px]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => toggleTool(tool.id, event.target.checked)}
                    />
                    {tool.id}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void onSaveRole();
              }}
              className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
            >
              保存 Role
            </button>
          </div>

          <div className="mt-3 rounded-lg border border-slate-200 bg-white p-2">
            <p className="text-xs font-semibold text-slate-700">LLM 优化 Role</p>
            <textarea
              rows={3}
              value={optimizeInstruction}
              onChange={(event) => setOptimizeInstruction(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              placeholder="例如：把该角色优化成学术论文审稿人，减少幻觉并加强引用约束。"
            />
            <button
              type="button"
              disabled={optimizing}
              onClick={() => {
                void onOptimizeRole();
              }}
              className="mt-2 rounded-xl border border-[#0d652d] bg-[#0d652d] px-4 py-2 text-sm font-semibold text-white enabled:hover:bg-[#0a4a21] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {optimizing ? "优化中..." : "用 LLM 优化 Role"}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {roles.length === 0 ? (
            <p className="text-sm text-slate-500">暂无角色配置。</p>
          ) : (
            roles.map((role) => (
              <article key={role.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-800">{role.id}</h3>
                  <button
                    type="button"
                    onClick={() => loadRoleToEditor(role)}
                    className="rounded-lg border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  >
                    加载到编辑器
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-slate-600">{role.systemPrompt}</p>
                <p className="mt-2 text-slate-500">allowedTools: {role.allowedTools.join(", ") || "-"}</p>
                <p className="mt-1 text-slate-500">
                  memoryScope: {role.memoryScope} · maxIterations: {role.maxIterations} · workspaceIsolation:{" "}
                  {role.workspaceIsolation ? "true" : "false"}
                </p>
              </article>
            ))
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-base font-bold">Tools & Skills</h2>
        <p className="mt-1 text-sm text-slate-500">工具和技能目录由 runtime 实时读取。</p>

        <h3 className="mt-4 text-sm font-semibold">Tools</h3>
        <div className="mt-2 space-y-2">
          {tools.length === 0 ? (
            <p className="text-sm text-slate-500">暂无工具。</p>
          ) : (
            tools.map((tool) => (
              <article key={tool.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-800">{tool.name}</h4>
                  <div className="flex items-center gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        tool.source === "mcp"
                          ? "border-violet-300 bg-violet-100 text-violet-700"
                          : "border-slate-300 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {tool.source}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] ${
                        tool.riskLevel === "high"
                          ? "border-amber-300 bg-amber-100 text-amber-700"
                          : "border-emerald-300 bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {tool.riskLevel}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-slate-500">{tool.description}</p>
              </article>
            ))
          )}
        </div>

        <h3 className="mt-4 text-sm font-semibold">Skills</h3>
        <div className="mt-2 space-y-2">
          {skills.length === 0 ? (
            <p className="text-sm text-slate-500">暂无技能。</p>
          ) : (
            skills.map((skill) => (
              <article
                key={`${skill.source}:${skill.name}`}
                className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold text-slate-800">{skill.name}</h4>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      skill.available
                        ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                        : "border-red-300 bg-red-100 text-red-700"
                    }`}
                  >
                    {skill.available ? "available" : "blocked"}
                  </span>
                </div>
                <p className="mt-1 text-slate-500">{skill.description}</p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-500">{skill.path}</p>
                {skill.requires.length > 0 ? (
                  <p className="mt-1 text-red-600">requires: {skill.requires.join(", ")}</p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
