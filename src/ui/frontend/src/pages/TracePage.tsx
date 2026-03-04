import type { StudioData } from "../studio/useStudioData";
import { formatTime, traceTypeStyle } from "../studio/types";

interface TracePageProps {
  studio: StudioData;
}

export function TracePage({ studio }: TracePageProps) {
  const { traces, snapshot } = studio;

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-base font-bold">Agent 运行态可观测性 (Trace)</h2>
        <p className="mt-1 text-sm text-slate-500">
          展示主 Agent 到子 Agent 的运行轨迹：Prompt、工具调用、工具返回、错误与迭代保护状态。
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5">
            runId: {snapshot?.run.id ?? "-"}
          </span>
          <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5">
            status: {snapshot?.run.status ?? "idle"}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="space-y-2">
          {traces.length === 0 ? (
            <p className="text-sm text-slate-500">暂无 Trace 记录。</p>
          ) : (
            traces.slice(0, 120).map((trace, index) => (
              <details key={trace.id} open={index < 4} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-700">
                    [{trace.type}] {trace.title}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] ${traceTypeStyle[trace.type]}`}>
                    {trace.status}
                  </span>
                </summary>
                <p className="mt-1 text-xs text-slate-500">{formatTime(trace.timestamp)}</p>
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
