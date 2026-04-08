---
name: wiki-ingest
description: Ingest a raw source file into the wiki. Reads the source, creates/updates wiki pages (source summary, entities, concepts), adds cross-references, and updates the index and log. Use when the user adds a new file to raw/ or asks to ingest a document.
---

# Wiki Ingest

Use this workflow when a new raw source needs to be incorporated into the wiki.

## Namespace Awareness

Check the runtime context for the **active namespace** (e.g. `@shared`, `@user-alice`, `@dept-engineering`). All pages are created within that namespace unless the user specifies otherwise. Broadly useful knowledge should also be linked from `@shared/`.

## Steps

1. **Locate the source**: Use `list_dir` on `raw/` to find the target file. Confirm with the user which file to ingest.

2. **Read the source**: Use `read_file` (for text/markdown) or `read_image` (for images). For PDFs, use `exec` to extract text first.

3. **Discuss with user** (interactive mode): Present the top 3-5 takeaways and ask the user which aspects to emphasize. Skip this step if the user requested batch/silent mode.

4. **Create source summary**: Write a page at `wiki/{namespace}/sources/<source-name>.md` with frontmatter:
   ```yaml
   ---
   title: "<Source Title>"
   type: source
   namespace: "<namespace>"
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   sources: ["raw/<filename>"]
   ---
   ```

5. **Update entity pages**: For each significant entity mentioned:
   - If `wiki/{namespace}/entities/<entity>.md` exists, read it and append new information with source attribution.
   - If it doesn't exist, create it with appropriate frontmatter.
   - If the entity is broadly relevant, also create/update `wiki/@shared/entities/<entity>.md` or add a cross-namespace link.

6. **Update concept pages**: For each significant concept, method, or theme:
   - If `wiki/{namespace}/concepts/<concept>.md` exists, update it.
   - If it doesn't exist, create it.
   - Note any contradictions between this source and existing wiki content.

7. **Cross-reference**: Use `[[page-name]]` within the same namespace. Use `[[@namespace/page-name]]` for cross-namespace references.

8. **Update index**: Read `wiki/{namespace}/index.md` and add/update entries for all new or modified pages.

9. **Update log**: Append to `wiki/{namespace}/log.md`:
   ```
   - [YYYY-MM-DD HH:MM] ingest: <source-name> — <brief description>. Pages created: N, updated: M.
   ```

## Quality Checks

- Every claim should be traceable to a source via `[[source-page]]` links.
- Entity/concept pages should synthesize across sources, not just repeat one.
- Contradictions must be explicitly noted with both positions and their source attributions.
- Do not modify anything in `raw/`.

## Batch Mode

When ingesting multiple sources at once:
- Process one source at a time.
- After each source, check if existing pages need revision.
- Minimize user interaction — only flag major contradictions or ambiguities.
