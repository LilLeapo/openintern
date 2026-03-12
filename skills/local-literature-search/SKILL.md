---
name: local-literature-search
description: Search the local literature workspace for evidence-backed answers using the markdown case summaries under docs/文献列表/cases, with targeted follow-up reads and a strict final JSON output shaped as {"docs_answer":"..."}.
---

# Local Literature Search

Use this skill for workflow nodes that answer questions from the local literature library in `docs/文献列表`.

## Goal

Produce a literature-grounded answer from the local workspace and finish with exactly one JSON object:

```json
{"docs_answer":"..."}
```

## Required Working Pattern

1. Stay inside workspace-relative paths.
2. Start from `docs/文献列表/cases`, not from the whole workspace and not from absolute paths.
3. Use markdown case summaries to identify relevant papers first.
4. Read only the most relevant few files, then stop and synthesize.
5. If needed, do one or two targeted follow-up reads for referenced attachments or extracted text. Do not brute-force the full attachments directory.

## Tool Guidance

- Prefer `list_dir("docs/文献列表")` and `list_dir("docs/文献列表/cases")`.
- Prefer `exec` with targeted `rg -n -i` searches inside `docs/文献列表/cases`.
- Prefer `read_file` on the specific case markdowns that match the query.
- Do not call `list_dir` on absolute paths.
- Do not run broad recursive searches over the entire workspace.
- Do not loop on repeated `grep`/`rg` searches after you already have enough evidence.

## Search Procedure

1. Derive 2-4 short keywords from the user question.
2. Run a targeted search in `docs/文献列表/cases`.
3. Select the top 2-5 matching case files.
4. Read those case files and extract:
   - title
   - year
   - keywords
   - summary or conclusion
   - numeric evidence or conditions when available
   - referenced attachment path when relevant
5. Only if the case summaries do not contain enough evidence, perform at most 2 targeted follow-ups on the referenced source material.
6. Synthesize a concise answer with evidence and file-based support.

## Stop Conditions

- Stop once you have enough evidence from a few relevant case files.
- If no strong local evidence exists, return that clearly in `docs_answer` instead of continuing to search indefinitely.
- Do not spend turns exhaustively scanning unrelated papers.

## Output Contract

- Your final response must be a JSON object.
- The object must contain exactly the key `docs_answer`.
- Put all prose inside the string value of `docs_answer`.
- Do not wrap the JSON in markdown fences.
- Do not end with plain text outside the JSON object.

## Answer Quality

- Prefer literature evidence over unsupported generalization.
- Mention concrete conditions, trends, and numbers when the local files provide them.
- If evidence is indirect or incomplete, say so briefly inside `docs_answer`.
