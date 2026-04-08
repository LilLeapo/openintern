---
name: wiki-query
description: Query the wiki to answer questions. Reads the index, locates relevant pages, synthesizes an answer, and optionally saves valuable analysis back to the wiki. Use when the user asks a knowledge question that the wiki can answer.
---

# Wiki Query

Use this workflow when the user asks a question that can be answered from wiki content.

## Namespace Awareness

Check the runtime context for the **active namespace** and **readable namespaces**. Always search across all readable namespaces — especially `@shared/` — to give the most complete answer.

## Steps

1. **Read indexes**: Read `wiki/{active-namespace}/index.md` and `wiki/@shared/index.md` (and any other readable namespaces) to identify potentially relevant pages.

2. **Read relevant pages**: Read the wiki pages most likely to contain the answer from any readable namespace. Start with concept/entity pages; drill into source summaries for detail.

3. **Synthesize answer**: Compose an answer that:
   - Cites wiki pages using `[[page-name]]` or `[[@namespace/page-name]]` links.
   - Distinguishes between well-supported conclusions and areas of uncertainty.
   - Notes any contradictions found across sources or namespaces.

4. **Decide whether to save**: If the answer required significant synthesis across 3+ pages or produced a novel analysis:
   - Save it as `wiki/{active-namespace}/analyses/<descriptive-name>.md` with frontmatter:
     ```yaml
     ---
     title: "<Analysis Title>"
     type: analysis
     namespace: "<active-namespace>"
     created: YYYY-MM-DD
     updated: YYYY-MM-DD
     sources: ["wiki/page1.md", "wiki/page2.md"]
     query: "<original user question>"
     ---
     ```
   - Update the active namespace's `index.md`.

5. **Log the query**: Append to `wiki/{active-namespace}/log.md`:
   ```
   - [YYYY-MM-DD HH:MM] query: "<question summary>" — namespaces consulted: N, analysis saved: yes/no.
   ```

## When Wiki Is Insufficient

If the wiki doesn't contain enough information:
- Say so explicitly, and list what's missing.
- Suggest specific raw sources that could be ingested to fill the gap.
- If `web_search` is available, offer to search for external sources.
- Do NOT hallucinate or fill gaps with general knowledge unless clearly labeled.

## Output Formats

Adapt output to the question type:
- Factual questions: concise answer with source citations.
- Comparison questions: markdown table comparing entities/concepts.
- Overview questions: structured summary with section headers.
- Timeline questions: chronological list of events with dates and sources.
