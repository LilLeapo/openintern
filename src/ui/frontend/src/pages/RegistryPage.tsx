import { FormEvent, useState } from "react";

import type { StudioData } from "../studio/useStudioData";
import { defaultSchema } from "../studio/types";

interface RegistryPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

interface RegistryForm {
  name: string;
  description: string;
  riskLevel: "low" | "high";
  inputSchema: string;
}

export function RegistryPage({ studio, notify }: RegistryPageProps) {
  const { tools, registerTool } = studio;
  const [form, setForm] = useState<RegistryForm>({
    name: "",
    description: "",
    riskLevel: "low",
    inputSchema: defaultSchema,
  });
  const [file, setFile] = useState<File | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      await registerTool({
        name: form.name,
        description: form.description,
        riskLevel: form.riskLevel,
        inputSchema: form.inputSchema,
        scriptName: file?.name,
        scriptContent: file ? await file.text() : undefined,
      });
      setForm({
        name: "",
        description: "",
        riskLevel: "low",
        inputSchema: defaultSchema,
      });
      setFile(null);
      notify("工具已注册");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[420px_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-base font-bold">Skill / Tool Registry</h2>
        <p className="mt-1 text-sm text-slate-500">上传 Python 脚本元数据并声明 JSON Schema，注册为全局 Tool。</p>

        <div className="mt-4 space-y-2 text-xs text-slate-600">
          <label className="block">
            工具名
            <input
              required
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              placeholder="calculate_faradaic_efficiency"
            />
          </label>

          <label className="block">
            功能描述
            <input
              required
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
              placeholder="计算法拉第效率"
            />
          </label>

          <label className="block">
            风险级别
            <select
              value={form.riskLevel}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, riskLevel: event.target.value as "low" | "high" }))
              }
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
            >
              <option value="low">低风险</option>
              <option value="high">高风险</option>
            </select>
          </label>

          <label className="block">
            Python 脚本（可选）
            <input
              type="file"
              accept=".py,.txt"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            JSON Schema
            <textarea
              required
              rows={8}
              value={form.inputSchema}
              onChange={(event) => setForm((prev) => ({ ...prev, inputSchema: event.target.value }))}
              className="mt-1 w-full resize-y rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs"
            />
          </label>
        </div>

        <button
          type="submit"
          className="mt-3 w-full rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
        >
          注册工具
        </button>
      </form>

      <div className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h3 className="text-sm font-bold">已注册工具</h3>
        <div className="mt-3 space-y-2">
          {tools.map((tool) => (
            <article key={tool.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
              <h4 className="font-semibold text-slate-800">{tool.name}</h4>
              <p className="mt-1 text-slate-500">{tool.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
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
              </div>
              {tool.scriptName ? (
                <p className="mt-2 font-mono text-[11px] text-slate-600">script: {tool.scriptName}</p>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
