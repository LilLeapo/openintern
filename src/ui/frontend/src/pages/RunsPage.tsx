import { useMemo, useState } from "react";

import type { StudioData } from "../studio/useStudioData";
import { formatTime, runStatusStyle, traceTypeStyle } from "../studio/types";

interface RunsPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

export function RunsPage({ studio, notify }: RunsPageProps) {
  const { runs, traces, runDetails, cancelRun, fullResync, loadRunDetail } = studio;
  const [openedRuns, setOpenedRuns] = useState<Record<string, boolean>>({});
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  const tracesByRun = useMemo(() => {
    const map = new Map<string, typeof traces>();
    for (const trace of traces) {
      const list = map.get(trace.runId) ?? [];
      list.push(trace);
      map.set(trace.runId, list);
    }
    return map;
  }, [traces]);

  const onCancel = async (runId: string) => {
    try {
      await cancelRun(runId);
      notify(`Run ${runId} 已取消`);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onRefresh = async () => {
    try {
      await fullResync();
      notify("运行态已同步");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onToggleRun = async (runId: string) => {
    const nextOpen = !openedRuns[runId];
    setOpenedRuns((prev) => ({
      ...prev,
      [runId]: nextOpen,
    }));

    if (!nextOpen) {
      return;
    }
    if (runDetails[runId]) {
      return;
    }

    setLoadingRunId(runId);
    try {
      await loadRunDetail(runId);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setLoadingRunId((current) => (current === runId ? null : current));
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div>
          <h2 className="text-base font-bold">Runtime Runs + Trace</h2>
          <p className="mt-1 text-sm text-slate-500">点击 Run 展开可查看节点、Trace、消息日志与工具调用记录。</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
        >
          立即同步
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="space-y-2">
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">暂无运行实例。</p>
          ) : (
            runs.map((run) => {
              const isOpen = openedRuns[run.runId] === true;
              const detail = runDetails[run.runId];
              const runTraces = detail?.traces ?? tracesByRun.get(run.runId) ?? [];
              const runActivities = detail?.activities ?? [];

              return (
                <article key={run.runId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800">
                      {run.runId} · {run.workflowId}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${runStatusStyle[run.status]}`}>
                        {run.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void onToggleRun(run.runId);
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700"
                      >
                        {isOpen ? "收起" : "展开"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-1 text-slate-500">started: {formatTime(run.startedAt)}</p>
                  <p className="mt-1 text-slate-500">ended: {formatTime(run.endedAt)}</p>
                  <p className="mt-1 text-slate-500">trace: {runTraces.length} 条</p>
                  {run.error ? <p className="mt-1 text-red-600">error: {run.error}</p> : null}

                  {(run.status === "running" || run.status === "waiting_for_approval") ? (
                    <button
                      type="button"
                      onClick={() => {
                        void onCancel(run.runId);
                      }}
                      className="mt-2 rounded-lg border border-red-300 bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-200"
                    >
                      取消运行
                    </button>
                  ) : null}

                  {isOpen ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                      {loadingRunId === run.runId ? (
                        <p className="text-xs text-slate-500">加载详情中...</p>
                      ) : null}

                      <div>
                        <h4 className="text-xs font-semibold text-slate-700">Nodes</h4>
                        <div className="mt-1 space-y-1">
                          {run.nodes.map((node) => (
                            <div key={node.id} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                              <p className="font-medium text-slate-700">
                                {node.id} · {node.status} · attempt {node.attempt}/{node.maxAttempts}
                              </p>
                              {node.lastError ? <p className="mt-1 text-red-600">{node.lastError}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-slate-700">Trace</h4>
                        <div className="mt-1 max-h-56 space-y-1 overflow-auto">
                          {runTraces.length === 0 ? (
                            <p className="text-xs text-slate-500">暂无 trace。</p>
                          ) : (
                            runTraces.slice(0, 120).map((trace) => (
                              <div key={trace.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[11px] font-medium text-slate-700">[{trace.type}] {trace.title}</p>
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                                      traceTypeStyle[trace.type] ?? "bg-slate-100 text-slate-700 border-slate-300"
                                    }`}
                                  >
                                    {trace.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-[11px] text-slate-500">{formatTime(trace.timestamp)}</p>
                                <pre className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700">
                                  {trace.details}
                                </pre>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-slate-700">Subagent Logs</h4>
                        <div className="mt-1 max-h-64 space-y-2 overflow-auto">
                          {runActivities.length === 0 ? (
                            <p className="text-xs text-slate-500">暂无子任务日志（任务未结束或未采集）。</p>
                          ) : (
                            runActivities.map((activity) => (
                              <div key={activity.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] font-semibold text-slate-700">
                                  {activity.type} · task={activity.taskId} · {formatTime(activity.timestamp)}
                                </p>
                                <p className="mt-1 text-[11px] text-slate-600">node={activity.nodeId ?? "-"} · role={activity.role ?? "-"}</p>

                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] text-slate-700">任务输入/输出</summary>
                                  <pre className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-700">
                                    TASK:\n{activity.task}\n\nRESULT:\n{activity.result}
                                  </pre>
                                </details>

                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] text-slate-700">
                                    工具调用（{activity.toolCalls.length}）
                                  </summary>
                                  <div className="mt-1 space-y-1">
                                    {activity.toolCalls.length === 0 ? (
                                      <p className="text-[11px] text-slate-500">无</p>
                                    ) : (
                                      activity.toolCalls.map((toolCall) => (
                                        <div key={toolCall.id} className="rounded border border-slate-200 bg-white p-2">
                                          <p className="text-[11px] font-medium text-slate-700">
                                            {toolCall.name} {toolCall.highRisk ? "(high-risk)" : ""}
                                          </p>
                                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-700">
                                            args: {JSON.stringify(toolCall.arguments, null, 2)}
                                          </pre>
                                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-700">
                                            result: {toolCall.result}
                                          </pre>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </details>

                                <details className="mt-1">
                                  <summary className="cursor-pointer text-[11px] text-slate-700">消息记录（{activity.messages.length}）</summary>
                                  <div className="mt-1 space-y-1">
                                    {activity.messages.length === 0 ? (
                                      <p className="text-[11px] text-slate-500">无</p>
                                    ) : (
                                      activity.messages.map((message, index) => (
                                        <div key={`${activity.id}:msg:${index}`} className="rounded border border-slate-200 bg-white p-2">
                                          <p className="text-[11px] font-medium text-slate-700">
                                            {message.role} · {formatTime(message.at)}
                                          </p>
                                          <pre className="mt-1 whitespace-pre-wrap font-mono text-[11px] text-slate-700">
                                            {message.content}
                                          </pre>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </details>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
