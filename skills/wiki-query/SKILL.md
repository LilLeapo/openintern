---
name: wiki-query
description: Query the wiki to answer questions. Reads the index, locates relevant pages, synthesizes an answer, and optionally saves valuable analysis back to the wiki. Use when the user asks a knowledge question that the wiki can answer.
---

# Wiki Query

Use this workflow when the user asks a question that can be answered from wiki content.

## Steps

1. **Read the index**: Read `wiki/index.md` to identify potentially relevant pages.

2. **Read relevant pages**: Read the wiki pages most likely to contain the answer. Start with concept/entity pages; drill into source summaries for detail.

3. **Synthesize answer**: Compose an answer that:
   - Cites wiki pages using `[[page-name]]` links.
   - Distinguishes between well-supported conclusions and areas of uncertainty.
   - Notes any contradictions found across sources.

4. **Decide whether to save**: If the answer required significant synthesis across 3+ pages or produced a novel comparison/analysis:
   - Save it as `wiki/analyses/<descriptive-name>.md` with frontmatter:
     ```yaml
     ---
     title: "<Analysis Title>"
     type: analysis
     created: YYYY-MM-DD
     updated: YYYY-MM-DD
     sources: ["wiki/page1.md", "wiki/page2.md"]
     query: "<original user question>"
     ---
     ```
   - Update `wiki/index.md` with the new analysis page.
   - Add `[[links]]` from relevant entity/concept pages to this analysis.

5. **Log the query**: Append to `wiki/log.md`:
   ```
   - [YYYY-MM-DD HH:MM] query: "<question summary>" — pages consulted: N, analysis saved: yes/no.
   ```

## When Wiki Is Insufficient

If the wiki doesn't contain enough information to answer:
- Say so explicitly, and list what's missing.
- Suggest specific raw sources that could be ingested to fill the gap.
- If `web_search` is available, offer to search for external sources.
- Do NOT hallucinate or fill gaps with general knowledge unless clearly labeled as such.

## Output Formats

Adapt output to the question type:
- Factual questions: concise answer with source citations.
- Comparison questions: markdown table comparing entities/concepts.
- Overview questions: structured summary with section headers.
- Timeline questions: chronological list of events with dates and sources.
