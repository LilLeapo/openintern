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
- inspect_file
- read_image
- write_file
- edit_file
- list_dir
- exec
- message
- web_search
- web_fetch
- memory_retrieve
- memory_save
- memory_delete
- trigger_workflow
- query_workflow_status
- draft_workflow
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
  "WIKI_SCHEMA.md": `# Wiki Schema

This workspace follows a three-layer knowledge architecture.

## Layer 1: Raw Sources (\`raw/\`)

Immutable original materials. The agent MUST NOT modify files in this directory.
Supported formats: PDF, markdown, text, HTML, images, data files.
Each source should keep its original filename.

## Layer 2: The Wiki (\`wiki/\`)

A set of interlinked markdown pages maintained exclusively by the agent.
The wiki is a **persistent, compounding artifact** — knowledge is compiled once and continuously maintained, not re-derived on every query.

### Page types

- **Source summaries** (\`wiki/sources/\`): One page per ingested raw source. Contains metadata, key takeaways, and links to related entity/concept pages.
- **Entity pages** (\`wiki/entities/\`): Pages about specific people, organizations, products, datasets, or other named entities.
- **Concept pages** (\`wiki/concepts/\`): Pages about themes, methods, theories, or abstract topics that span multiple sources.
- **Analysis pages** (\`wiki/analyses/\`): Comparative analyses, synthesis across sources, or answers to complex queries worth preserving.

### Conventions

- Use \`[[page-name]]\` wiki-link syntax for cross-references.
- Every page starts with a YAML frontmatter block: title, type, created, updated, sources.
- Keep pages focused — one entity or concept per page. Split when a page exceeds ~800 words.
- When updating a page, increment the \`updated\` date.
- When information from a new source contradicts existing wiki content, note both positions with source attribution.

## Layer 3: This Schema

This file defines the rules. The agent reads and follows it; the user edits it to steer wiki behavior.

## Operations

### Ingest

When a new file appears in \`raw/\`:
1. Read the raw source completely.
2. Discuss key takeaways with the user (unless batch mode).
3. Create a source summary page in \`wiki/sources/\`.
4. Update or create entity pages in \`wiki/entities/\`.
5. Update or create concept pages in \`wiki/concepts/\`.
6. Add cross-references (\`[[links]]\`) between all affected pages.
7. Update \`wiki/index.md\` with the new/changed pages.
8. Append an entry to \`wiki/log.md\`.

### Query

When the user asks a question:
1. Read \`wiki/index.md\` to locate relevant pages.
2. Read the relevant wiki pages.
3. Synthesize an answer grounded in wiki content, citing source pages.
4. If the answer required significant synthesis, save it as an analysis page in \`wiki/analyses/\`.
5. Log the query in \`wiki/log.md\`.

### Lint

Periodic wiki health check:
1. Scan all wiki pages for broken \`[[links]]\`.
2. Find contradictions between pages.
3. Identify orphan pages (no inbound links).
4. Find concepts mentioned frequently but lacking a dedicated page.
5. Check for stale pages (not updated after newer related sources were ingested).
6. Report findings and optionally fix them.
7. Log the lint run in \`wiki/log.md\`.

### Index & Log

- \`wiki/index.md\`: Master index of all wiki pages with one-line descriptions.
- \`wiki/log.md\`: Chronological record of all operations (ingest, query, lint).
`,
  "wiki/index.md": `# Wiki Index

Master index of all wiki pages. One line per page.

<!-- Format: - [Page Title](relative/path.md) — one-line description -->
`,
  "wiki/log.md": `# Wiki Log

Chronological record of wiki operations.

<!-- Format: - [YYYY-MM-DD HH:MM] <operation> description -->
`,
  "wiki/sources/.gitkeep": ``,
  "wiki/entities/.gitkeep": ``,
  "wiki/concepts/.gitkeep": ``,
  "wiki/analyses/.gitkeep": ``,
  "raw/.gitkeep": ``,
};
