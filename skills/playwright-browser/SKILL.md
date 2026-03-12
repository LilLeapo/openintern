---
name: playwright-browser
description: Use Playwright MCP for deterministic browser automation, page inspection, screenshots, form interaction, and lightweight web workflows. Trigger when users want the agent to open sites, click through flows, fill forms, inspect pages, or capture browser evidence.
---

# Playwright Browser

Use this skill when the task needs live browser interaction rather than plain HTTP fetches.

## Preconditions

- Prefer the Playwright MCP tools exposed from the `playwright-mcp` server.
- If browser tools are missing, report that the MCP server is not connected instead of pretending to browse.
- If the MCP reports that the configured browser is not installed, call `playwright-mcp__browser_install`.

## Workflow

1. Start with `playwright-mcp__browser_navigate`.
2. Read page structure with `playwright-mcp__browser_snapshot`.
3. Use snapshot refs for interactions such as:
   - `playwright-mcp__browser_click`
   - `playwright-mcp__browser_type`
   - `playwright-mcp__browser_select_option`
   - `playwright-mcp__browser_hover`
4. Use `playwright-mcp__browser_wait_for` after actions that trigger async page updates.
5. Use `playwright-mcp__browser_take_screenshot` only for evidence or user-facing artifacts; use snapshots for reasoning.
6. Use `playwright-mcp__browser_tabs` when flows open new tabs or require switching context.
7. For custom DOM or network-level investigation, use:
   - `playwright-mcp__browser_run_code`
   - `playwright-mcp__browser_network_requests`

## Guardrails

- Prefer accessibility snapshot driven actions over coordinate-based actions.
- Do not use screenshots as the primary source for deciding what to click.
- Keep navigation focused on the user task; avoid unrelated browsing.
- When handling uploads, pass absolute file paths that already exist locally.
- If login or MFA blocks progress, stop and report exactly where manual intervention is needed.

## Output

- Summarize the steps performed.
- Include any captured artifact paths if screenshots, PDFs, or saved outputs were produced.
- Call out blockers such as login walls, missing browser install, or anti-bot challenges.
