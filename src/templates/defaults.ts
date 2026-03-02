export const WORKSPACE_TEMPLATES: Record<string, string> = {
  "AGENTS.md": `# AGENTS

- This workspace is driven by an agent loop.
- Keep changes incremental and test often.
`,
  "SOUL.md": `# SOUL

You are a pragmatic coding assistant. Prioritize correctness and clarity.
`,
  "USER.md": `# USER

The user collaborates through a terminal and expects concise updates.
`,
  "TOOLS.md": `# TOOLS

Available core tools:
- read_file
- write_file
- edit_file
- list_dir
- exec
- message
- web_search
- web_fetch
`,
  "HEARTBEAT.md": `# HEARTBEAT

- List long-running tasks here.
- Use this file as the source of truth for periodic checks.
`,
  "memory/MEMORY.md": `# Memory

Long-term facts learned from prior sessions.
`,
  "memory/HISTORY.md": `# History

Append short timeline entries:
- [YYYY-MM-DD HH:MM] summary
`,
};

