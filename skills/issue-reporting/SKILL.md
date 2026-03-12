---
name: issue-reporting
description: Collect recent logs and execution context, generate a diagnostic report, and send it to a Feishu chat or user when the user reports a bug, says the result is unsatisfactory, or asks to forward troubleshooting logs to someone for debugging.
---

# Issue Reporting

Use this skill when the user says there is a bug, the result is wrong, the behavior is unsatisfactory, or asks you to send logs or a diagnostic package to a Feishu user for troubleshooting.

## Goal

Generate a diagnostic report with recent logs and current execution context, then send it to the right Feishu target.

## Trigger Rules

Use this skill for requests like:

- "有 bug，帮我把日志发给某个飞书用户"
- "这个结果不对，打包一下日志给 XXX"
- "我不满意这个行为，帮我把诊断信息发出去"
- "把最近的报错和上下文发给飞书上的某个人"

## Workflow

1. Extract the problem summary from the user's complaint.
2. Decide the target:
   - If the user clearly gave a Feishu `open_id` or chat ID, use it.
   - If they said to send it back to the current conversation, use the current channel/chat.
   - If the destination is ambiguous and sending to the wrong person is risky, ask for the exact Feishu user or chat ID.
3. Call `report_issue` with:
   - `note`: concise bug summary in Chinese.
   - `channel`: usually `feishu` if the target is a Feishu user.
   - `chat_id`: target user or chat ID.
   - `minutes`: usually 30 unless the user asked for a different range.
   - `include_session`: usually `true`.
   - `include_workflows`: usually `true`.
   - `send`: `true`.
4. After the tool succeeds, tell the user:
   - who it was sent to
   - whether the report file was generated successfully
   - any limitation, such as missing target ID or missing logs

## Guardrails

- Do not invent a Feishu target ID.
- Prefer sending the report file rather than pasting raw logs into chat.
- Keep the `note` focused on the actual bug symptoms and user dissatisfaction.
- If the user explicitly does not want logs sent externally, do not call `report_issue`.
- If sending fails, report the failure and give the generated report path if available.
