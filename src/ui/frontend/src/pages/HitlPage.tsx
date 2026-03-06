import type { StudioData } from "../studio/useStudioData";
import { formatTime } from "../studio/types";

interface HitlPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

export function HitlPage({ studio, notify }: HitlPageProps) {
  const { approvals, approve, createTestApproval } = studio;

  const onApprove = async (approvalId: string) => {
    try {
      await approve(approvalId);
      notify("审批通过，运行已恢复");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3">
      <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold">Human-in-the-Loop 审批队列</h2>
            <p className="mt-1 text-sm text-slate-500">实时来自 runtime，审批动作直接写回 WorkflowEngine。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void createTestApproval()
                .then(() => notify("已创建测试审批请求"))
                .catch((error) => notify(error instanceof Error ? error.message : String(error), "error"));
            }}
            className="rounded-xl border border-[#bad5c5] bg-[#edf6f1] px-3 py-2 text-xs font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
          >
            创建测试审批请求
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <div className="space-y-2">
          {approvals.length === 0 ? (
            <p className="text-sm text-slate-500">暂无审批请求。</p>
          ) : (
            approvals.map((approval) => (
              <article key={approval.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                <div className="mb-1 flex flex-wrap gap-1">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] ${
                      approval.status === "pending"
                        ? "border-amber-300 bg-amber-100 text-amber-700"
                        : approval.status === "approved"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                          : "border-red-300 bg-red-100 text-red-700"
                    }`}
                  >
                    {approval.status}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                    {approval.target}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                    run={approval.runId}
                  </span>
                </div>

                <p className="text-slate-700">
                  <strong>{approval.nodeName}</strong> 请求执行 <code>{approval.toolId}</code>
                </p>
                {approval.commandPreview ? (
                  <p className="mt-1 text-slate-500">
                    指令预览: <code>{approval.commandPreview}</code>
                  </p>
                ) : null}
                {approval.toolCalls && approval.toolCalls.length > 0 ? (
                  <p className="mt-1 text-slate-500">
                    批次工具: {approval.toolCalls.map((toolCall) => toolCall.name).join(", ")}
                  </p>
                ) : null}
                <p className="mt-1 text-slate-500">发起时间: {formatTime(approval.requestedAt)}</p>
                {approval.expiresAt ? (
                  <p className="mt-1 text-slate-500">过期时间: {formatTime(approval.expiresAt)}</p>
                ) : null}
                {approval.reason ? <p className="mt-1 text-slate-500">原因: {approval.reason}</p> : null}

                {approval.status === "pending" ? (
                  <button
                    type="button"
                    onClick={() => onApprove(approval.id)}
                    className="mt-2 rounded-lg border border-[#bad5c5] bg-[#edf6f1] px-3 py-1.5 text-xs font-semibold text-[#1d5b3d] hover:bg-[#e2f1e9]"
                  >
                    批准并恢复
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
