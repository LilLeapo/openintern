import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { StudioNav } from "./components/StudioNav";
import { HitlPage } from "./pages/HitlPage";
import { RegistryPage } from "./pages/RegistryPage";
import { RunsPage } from "./pages/RunsPage";
import { WorkflowPage } from "./pages/WorkflowPage";
import { formatTime, freshnessStyle } from "./studio/types";
import { useStudioData } from "./studio/useStudioData";

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/runs")) {
    return "Runtime Runs + Trace";
  }
  if (pathname.startsWith("/hitl")) {
    return "Human-in-the-Loop 审批流";
  }
  if (pathname.startsWith("/workflow")) {
    return "SOP 串联与 Runtime 编排";
  }
  if (pathname.startsWith("/registry")) {
    return "Roles / Tools / Skills";
  }
  return "Runtime Dashboard";
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

  const latestRun = useMemo(() => studio.runs[0] ?? null, [studio.runs]);

  return (
    <div className="flex h-screen w-screen overflow-hidden text-slate-800">
      <StudioNav />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="inline-flex rounded-md bg-blue-100 px-2 py-1 text-[11px] font-bold tracking-wide text-blue-700">
              OpenIntern Runtime Console
            </span>
            <h1 className="mt-2 text-lg font-bold">{pageTitle(location.pathname)}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className={`status-chip border ${freshnessStyle[studio.freshness]}`}>
              freshness: {studio.freshness}
            </span>
            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5">
              runtime: {studio.runtimeAvailable ? "available" : "unavailable"}
            </span>
            <span>
              latest run: {latestRun ? `${latestRun.runId} (${latestRun.status})` : "-"}
            </span>
            <span>
              {latestRun?.endedAt
                ? `last end: ${formatTime(latestRun.endedAt)}`
                : latestRun
                  ? `started: ${formatTime(latestRun.startedAt)}`
                  : "-"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void studio
                  .refreshAll()
                  .then(() => notify("全量状态已刷新"))
                  .catch((error) => notify(error instanceof Error ? error.message : String(error), "error"));
              }}
              className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-4 py-2 text-sm font-semibold text-[#1d5b3d] transition hover:bg-[#e2f1e9]"
            >
              刷新状态
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Routes>
            <Route path="/" element={<Navigate to="/workflow" replace />} />
            <Route path="/workflow" element={<WorkflowPage studio={studio} notify={notify} />} />
            <Route path="/runs" element={<RunsPage studio={studio} notify={notify} />} />
            <Route path="/hitl" element={<HitlPage studio={studio} notify={notify} />} />
            <Route path="/trace" element={<Navigate to="/runs" replace />} />
            <Route path="/registry" element={<RegistryPage studio={studio} notify={notify} />} />
          </Routes>
        </div>
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
