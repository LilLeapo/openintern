---
name: pdf-ingest
description: Ingest PDF literature into papers memory scope with a deterministic pipeline (extract text, chunk, save, verify). Use when users ask to add PDFs or documents into memory or treat them as RAG knowledge.
---

# PDF Ingest Workflow

Use this workflow when the user asks to add a PDF into knowledge memory.

## Steps

1. Validate input path with `list_dir`/`read_file` context and confirm target PDF exists.
2. Extract text with `exec`.
3. Chunk extracted text into manageable pieces (for example 1200-2000 chars per chunk with small overlap).
4. Save each chunk via `memory_save` with `scope="papers"`.
5. Verify ingestion by calling `memory_retrieve` with `scope="papers"` and a query about the document.

## Execution Guidance

- Prefer background execution with `spawn` for large or multiple PDFs.
- Prefix chunk content with a stable document tag, such as `[paper:<filename> chunk i/n]`.
- Skip empty or very short chunks.
- If extraction fails, report failure and stop instead of saving partial garbage.

## Quality Checks

- Ensure chunk ordering is preserved.
- Keep chunks textual and clean (remove obvious boilerplate artifacts where possible).
- After ingestion, provide a short report: file name, chunk count, verification query result.

