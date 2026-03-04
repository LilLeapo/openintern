import { useMemo, useState } from "react";

import type { StudioData } from "../studio/useStudioData";
import { formatTime, traceTypeStyle } from "../studio/types";

interface TracePageProps {
  studio: StudioData;
}

export function TracePage({ studio }: TracePageProps) {
  const { traces, runs } = studio;
  const [runFilter, setRunFilter] = useState<string>("all");

  const visibleTraces = useMemo(() => {
    if (runFilter === "all") {
      return traces;
    }
    return traces.filter((trace) => trace.runId === runFilter);
  }, [runFilter, traces]);

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-base font-bold">Runtime Trace</h2>
        <p className="mt-1 text-sm text-slate-500">显示 workflow 运行、节点状态、审批和 subagent 事件。</p>
        <div className="mt-3 max-w-xs">
          <label className="block text-xs text-slate-600">
            按 run 过滤
            <select
              value={runFilter}
              onChange={(event) => setRunFilter(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="all">全部</option>
              {runs.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {run.runId} ({run.status})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="space-y-2">
          {visibleTraces.length === 0 ? (
            <p className="text-sm text-slate-500">暂无 Trace 记录。</p>
          ) : (
            visibleTraces.slice(0, 300).map((trace, index) => (
              <details key={trace.id} open={index < 4} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    [{trace.type}] {trace.title}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      traceTypeStyle[trace.type] ?? "bg-slate-100 text-slate-700 border-slate-300"
                    }`}
                  >
                    {trace.status}
                  </span>
                </summary>
                <p className="mt-1 text-xs text-slate-500">
                  {formatTime(trace.timestamp)} · run={trace.runId}
                </p>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-slate-300 bg-slate-100 p-2 font-mono text-xs text-slate-700">
                  {trace.details}
                </pre>
              </details>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
