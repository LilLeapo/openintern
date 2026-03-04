import type { StudioData } from "../studio/useStudioData";
import { formatTime } from "../studio/types";

interface HitlPageProps {
  studio: StudioData;
  notify: (message: string, type?: "ok" | "error") => void;
}

export function HitlPage({ studio, notify }: HitlPageProps) {
  const { highRiskAgentNodes, approvals, updateNode, approve } = studio;

  const onToggleHitl = async (nodeId: string, checked: boolean) => {
    try {
      await updateNode(nodeId, { requiresApproval: checked });
      notify("HITL 配置已更新");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onTargetChange = async (nodeId: string, target: "owner" | "group") => {
    try {
      await updateNode(nodeId, { approvalTarget: target });
      notify("审批目标已更新");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const onApprove = async (approvalId: string) => {
    try {
      await approve(approvalId);
      notify("审批通过，子 Agent 已被 Message Bus 唤醒");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-base font-bold">Human-in-the-Loop (HITL) 配置</h2>
        <p className="mt-1 text-sm text-slate-500">
          为高危工具执行增加人工授权开关。开启后，运行会在执行前挂起并发起审批。
        </p>

        <div className="mt-4 space-y-3">
          {highRiskAgentNodes.length === 0 ? (
            <p className="text-sm text-slate-500">暂无 Agent 节点。</p>
          ) : (
            highRiskAgentNodes.map(({ node, hasHighRiskTool }) => (
              <article key={node.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-800">{node.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">role: {node.role ?? "-"}</p>
                  </div>
                  <label className="inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={node.requiresApproval}
                      onChange={(event) => onToggleHitl(node.id, event.target.checked)}
                    />
                    <span className="toggle" />
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full border px-2 py-0.5 ${
                      hasHighRiskTool
                        ? "border-amber-300 bg-amber-100 text-amber-700"
                        : "border-slate-300 bg-slate-100 text-slate-600"
                    }`}
                  >
                    {hasHighRiskTool ? "包含高危工具" : "仅低风险工具"}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-slate-600">
                    tools: {node.toolIds.join(", ") || "-"}
                  </span>
                </div>

                <div className="mt-3 max-w-xs">
                  <label className="block text-xs text-slate-600">
                    审批目标
                    <select
                      value={node.approvalTarget}
                      onChange={(event) =>
                        onTargetChange(node.id, event.target.value as "owner" | "group")
                      }
                      className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="owner">触发者 (owner)</option>
                      <option value="group">研发审批群 (group)</option>
                    </select>
                  </label>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <aside className="min-h-0 overflow-auto rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-panel">
        <h2 className="text-sm font-bold">审批队列</h2>
        <p className="mt-1 text-xs text-slate-500">审批通过后会触发 Message Bus 恢复执行。</p>

        <div className="mt-3 space-y-2">
          {approvals.length === 0 ? (
            <p className="text-xs text-slate-500">暂无审批请求。</p>
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
                          : "border-slate-300 bg-slate-100 text-slate-600"
                    }`}
                  >
                    {approval.status}
                  </span>
                  <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                    {approval.target}
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
                {approval.parameters ? (
                  <p className="mt-1 text-slate-500">
                    参数: 电压 {approval.parameters.voltageV}V, 流量 {approval.parameters.flowSccm}sccm
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
                    批准并唤醒
                  </button>
                ) : null}
              </article>
            ))
          )}
        </div>
      </aside>
    </section>
  );
}
