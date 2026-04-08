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

This workspace follows a three-layer knowledge architecture with namespace isolation.

## Layer 1: Raw Sources (\`raw/\`)

Immutable original materials. The agent MUST NOT modify files in this directory.
Supported formats: PDF, markdown, text, HTML, images, data files.
Each source should keep its original filename.

## Layer 2: The Wiki (\`wiki/\`)

A set of interlinked markdown pages maintained exclusively by the agent.
The wiki is a **persistent, compounding artifact** — knowledge is compiled once and continuously maintained, not re-derived on every query.

### Namespaces

Wiki content is organized into namespaces, each with its own page hierarchy:

\`\`\`
wiki/
├── @shared/            # Shared across all users and departments
│   ├── index.md
│   ├── log.md
│   ├── sources/
│   ├── entities/
│   ├── concepts/
│   └── analyses/
├── @user-alice/        # Alice's personal wiki (auto-created)
│   ├── index.md
│   └── ...
├── @dept-engineering/  # Engineering department wiki (auto-created)
│   ├── index.md
│   └── ...
\`\`\`

**Namespace rules**:
- \`@shared/\` — visible to everyone. Default namespace for general knowledge.
- \`@user-{id}/\` — personal namespace, created per user. Private notes, personal research.
- \`@dept-{name}/\` — department namespace, shared within a team.
- Each namespace has its own \`index.md\`, \`log.md\`, and page subdirectories.
- A namespace is auto-created on first write if it does not exist.

**Cross-namespace references**:
- Within same namespace: \`[[page-name]]\`
- Across namespaces: \`[[@shared/page-name]]\` or \`[[@dept-engineering/page-name]]\`
- Prefer placing broadly useful knowledge in \`@shared/\`.

### Page types

- **Source summaries** (\`sources/\`): One page per ingested raw source.
- **Entity pages** (\`entities/\`): People, organizations, products, datasets.
- **Concept pages** (\`concepts/\`): Themes, methods, theories, abstract topics.
- **Analysis pages** (\`analyses/\`): Cross-source synthesis, query results worth preserving.

### Conventions

- Use \`[[page-name]]\` wiki-link syntax for cross-references.
- Every page starts with a YAML frontmatter block: title, type, namespace, created, updated, sources.
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
3. Determine target namespace (default: current user's active namespace).
4. Create a source summary page in \`{namespace}/sources/\`.
5. Update or create entity pages in \`{namespace}/entities/\`.
6. Update or create concept pages in \`{namespace}/concepts/\`.
7. Add cross-references (\`[[links]]\`) between all affected pages.
8. Update \`{namespace}/index.md\` with the new/changed pages.
9. Append an entry to \`{namespace}/log.md\`.
10. If entities/concepts are broadly relevant, also update or link from \`@shared/\`.

### Query

When the user asks a question:
1. Read the active namespace's \`index.md\` to locate relevant pages.
2. Also read \`@shared/index.md\` for shared knowledge.
3. Read the relevant wiki pages from any namespace.
4. Synthesize an answer grounded in wiki content, citing source pages.
5. If the answer required significant synthesis, save it as an analysis page.
6. Log the query in the active namespace's \`log.md\`.

### Lint

Periodic wiki health check (runs per namespace and cross-namespace):
1. Scan all wiki pages for broken \`[[links]]\`.
2. Find contradictions between pages.
3. Identify orphan pages (no inbound links).
4. Find concepts mentioned frequently but lacking a dedicated page.
5. Check for stale pages.
6. Detect duplicates across namespaces that should be consolidated into \`@shared/\`.
7. Report findings and optionally fix them.
8. Log the lint run in the relevant namespace's \`log.md\`.

### Index & Log

- \`{namespace}/index.md\`: Namespace-scoped index of all pages with one-line descriptions.
- \`{namespace}/log.md\`: Namespace-scoped chronological record of operations.
`,
  "wiki/@shared/index.md": `# Wiki Index — @shared

Master index of shared wiki pages. One line per page.

<!-- Format: - [Page Title](relative/path.md) — one-line description -->
`,
  "wiki/@shared/log.md": `# Wiki Log — @shared

Chronological record of wiki operations.

<!-- Format: - [YYYY-MM-DD HH:MM] <operation> description -->
`,
  "wiki/@shared/sources/.gitkeep": ``,
  "wiki/@shared/entities/.gitkeep": ``,
  "wiki/@shared/concepts/.gitkeep": ``,
  "wiki/@shared/analyses/.gitkeep": ``,
  "raw/.gitkeep": ``,
};
