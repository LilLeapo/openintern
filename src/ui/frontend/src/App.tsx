import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { StudioNav } from "./components/StudioNav";
import { HitlPage } from "./pages/HitlPage";
import { RegistryPage } from "./pages/RegistryPage";
import { TracePage } from "./pages/TracePage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { formatTime, runStatusStyle } from "./studio/types";
import { useStudioData } from "./studio/useStudioData";

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/hitl")) {
    return "Human-in-the-Loop 审批流";
  }
  if (pathname.startsWith("/workflow")) {
    return "SOP 串联与 DAG 编排";
  }
  if (pathname.startsWith("/trace")) {
    return "Agent 运行轨迹 Trace";
  }
  if (pathname.startsWith("/registry")) {
    return "Skill / Tool Registry";
  }
  return "Workflow Studio";
}

export default function App() {
  const studio = useStudioData();
  const location = useLocation();
  const [toast, setToast] = useState<{ type: "ok" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notify = (message: string, type: "ok" | "error" = "ok") => {
    setToast({ type, message });
  };

  const run = studio.snapshot?.run;
  const runStyle = runStatusStyle[run?.status ?? "idle"];

  const currentNode = useMemo(() => {
    if (!run?.currentNodeId) {
      return "-";
    }
    return studio.nodes.find((node) => node.id === run.currentNodeId)?.name ?? "-";
  }, [run?.currentNodeId, studio.nodes]);

  const onStartRun = async () => {
    try {
      await studio.startRun();
      notify("SOP 模拟运行已启动");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-800">
      <StudioNav />

      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-md bg-blue-100 px-2 py-1 text-[11px] font-bold tracking-wide text-blue-700">
              OpenIntern 模块页
            </span>
            <h1 className="mt-2 text-lg font-bold">{pageTitle(location.pathname)}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className={`status-chip border ${runStyle}`}>{run?.status.toUpperCase() ?? "IDLE"}</span>
            <span>当前节点: {currentNode}</span>
            <span>
              {run?.pauseReason
                ? `暂停原因: ${run.pauseReason}`
                : run?.endedAt
                  ? `结束时间: ${formatTime(run.endedAt)}`
                  : "-"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStartRun}
              className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] transition hover:bg-[#e2f1e9]"
            >
              模拟运行
            </button>
            <button
              type="button"
              onClick={() => notify("已发布到 mock 环境，后续可接入真实 Agent Runtime")}
              className="rounded-xl border border-[#0d652d] bg-[#0d652d] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0a4a21]"
            >
              发布 SOP
            </button>
          </div>
        </header>

        <Routes>
          <Route path="/" element={<Navigate to="/workflow" replace />} />
          <Route path="/workflow" element={<WorkflowPage studio={studio} notify={notify} />} />
          <Route path="/hitl" element={<HitlPage studio={studio} notify={notify} />} />
          <Route path="/trace" element={<TracePage studio={studio} />} />
          <Route path="/registry" element={<RegistryPage studio={studio} notify={notify} />} />
        </Routes>
      </main>

      {toast ? (
        <div
          className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-sm text-white shadow-lg ${
            toast.type === "error" ? "bg-red-700" : "bg-emerald-700"
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
