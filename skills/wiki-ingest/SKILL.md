---
name: wiki-ingest
description: Ingest a raw source file into the wiki. Reads the source, creates/updates wiki pages (source summary, entities, concepts), adds cross-references, and updates the index and log. Use when the user adds a new file to raw/ or asks to ingest a document.
---

# Wiki Ingest

Use this workflow when a new raw source needs to be incorporated into the wiki.

## Steps

1. **Locate the source**: Use `list_dir` on `raw/` to find the target file. Confirm with the user which file to ingest.

2. **Read the source**: Use `read_file` (for text/markdown) or `read_image` (for images). For PDFs, use `exec` to extract text first.

3. **Discuss with user** (interactive mode): Present the top 3-5 takeaways and ask the user which aspects to emphasize. Skip this step if the user requested batch/silent mode.

4. **Create source summary**: Write a page at `wiki/sources/<source-name>.md` with frontmatter:
   ```yaml
   ---
   title: "<Source Title>"
   type: source
   created: YYYY-MM-DD
   updated: YYYY-MM-DD
   sources: ["raw/<filename>"]
   ---
   ```
   Include: key findings, methodology (if applicable), limitations, and relevance to existing wiki content.

5. **Update entity pages**: For each significant entity (person, org, product, dataset) mentioned:
   - If `wiki/entities/<entity>.md` exists, read it and append new information with source attribution.
   - If it doesn't exist, create it with appropriate frontmatter.
   - Add `[[links]]` to the source summary page.

6. **Update concept pages**: For each significant concept, method, or theme:
   - If `wiki/concepts/<concept>.md` exists, update it.
   - If it doesn't exist, create it.
   - Note any contradictions between this source and existing wiki content.

7. **Cross-reference**: Ensure all created/updated pages link to each other where relevant using `[[page-name]]` syntax.

8. **Update index**: Read `wiki/index.md` and add/update entries for all new or modified pages.

9. **Update log**: Append to `wiki/log.md`:
   ```
   - [YYYY-MM-DD HH:MM] ingest: <source-name> — <brief description>. Pages created: N, updated: M.
   ```

## Quality Checks

- Every claim in a wiki page should be traceable to a source via `[[source-page]]` links.
- Entity/concept pages should synthesize across sources, not just repeat one source.
- Contradictions must be explicitly noted with both positions and their source attributions.
- Do not modify anything in `raw/`.

## Batch Mode

When ingesting multiple sources at once:
- Process one source at a time.
- After each source, check if existing pages need revision in light of cumulative new information.
- Minimize user interaction — only flag major contradictions or ambiguities.
