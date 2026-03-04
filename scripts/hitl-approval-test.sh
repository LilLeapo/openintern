#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${OPENINTERN_UI_BASE:-http://127.0.0.1:18791}"
RUN_ID=""
AUTO_APPROVE="false"

for arg in "$@"; do
  if [[ "$arg" == "--approve" ]]; then
    AUTO_APPROVE="true"
  elif [[ -z "$RUN_ID" ]]; then
    RUN_ID="$arg"
  fi
done

if [[ -z "$RUN_ID" ]]; then
  RUN_ID="run_ui_approval_demo"
fi

payload=$(cat <<JSON
{
  "runId": "${RUN_ID}",
  "workflowId": "wf_ui_approval_demo",
  "nodeId": "node_risky_exec",
  "nodeName": "Risky Command Node",
  "approvalTarget": "owner",
  "commandPreview": "exec: rm -rf /tmp/demo (simulated)",
  "toolCalls": [
    {
      "name": "exec",
      "arguments": {
        "command": "echo simulated approval command"
      },
      "highRisk": true
    }
  ]
}
JSON
)

echo "[1/3] Creating approval request via ${BASE_URL}/api/runtime/hitl/approvals/test-request"
response=$(curl -sS -X POST "${BASE_URL}/api/runtime/hitl/approvals/test-request" \
  -H 'Content-Type: application/json' \
  -d "$payload")

echo "$response"

approval_id=$(printf '%s' "$response" | node -e '
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
try {
  const payload = JSON.parse(raw);
  const id = payload?.data?.approval?.approvalId;
  process.stdout.write(typeof id === "string" ? id : "");
} catch {
  process.stdout.write("");
}
')

if [[ -z "$approval_id" ]]; then
  echo "Failed to parse approvalId from API response." >&2
  exit 1
fi

echo ""
echo "[2/3] Pending approvals:"
curl -sS "${BASE_URL}/api/runtime/hitl/approvals?pendingOnly=true"

echo ""
echo "Approval created: ${approval_id}"
echo "Open Dashboard HITL page to verify UI queue."

if [[ "$AUTO_APPROVE" == "true" ]]; then
  echo ""
  echo "[3/3] Approving ${approval_id}"
  curl -sS -X POST "${BASE_URL}/api/runtime/hitl/approvals/${approval_id}/approve" \
    -H 'Content-Type: application/json' \
    -d '{"approver":"ui-tester"}'
  echo ""
  echo "Approved."
else
  echo ""
  echo "To approve manually:"
  echo "curl -s -X POST ${BASE_URL}/api/runtime/hitl/approvals/${approval_id}/approve -H 'Content-Type: application/json' -d '{\"approver\":\"ui-tester\"}'"
fi
