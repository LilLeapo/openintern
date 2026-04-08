---
name: wiki-lint
description: Run a health check on the wiki. Finds broken links, contradictions, orphan pages, missing pages, stale content, and incomplete cross-references. Use periodically or when the user asks to clean up the wiki.
---

# Wiki Lint

Use this workflow to audit wiki quality and fix issues.

## Checks

### 1. Broken Links
- Scan all wiki pages for `[[page-name]]` references.
- Verify each linked page exists.
- Report broken links with the page and line where they appear.

### 2. Orphan Pages
- Find pages with zero inbound `[[links]]` from other pages.
- Suggest where cross-references should be added, or whether the page should be merged/deleted.

### 3. Missing Pages
- Find `[[page-name]]` links that point to non-existent pages.
- For each, assess whether a page should be created or the link removed.

### 4. Contradictions
- Read pages that cover overlapping topics.
- Flag where two pages make conflicting claims.
- Note the source attribution for each claim.

### 5. Stale Content
- Compare source summary `updated` dates against `raw/` file modification times.
- If a raw source is newer than its wiki summary, flag for re-ingestion.
- If related sources were ingested after a concept/entity page was last updated, flag for review.

### 6. Index Completeness
- Verify every wiki page appears in `wiki/index.md`.
- Verify every `wiki/index.md` entry points to an existing file.

### 7. Frequently Mentioned Concepts Without Pages
- Scan for terms/names that appear in 3+ pages but have no dedicated entity/concept page.
- Suggest creating pages for the most significant ones.

## Output

Produce a lint report organized by check category:
```markdown
## Wiki Lint Report — YYYY-MM-DD

### Broken Links (N)
- ...

### Orphan Pages (N)
- ...

### Missing Pages (N)
- ...

### Contradictions (N)
- ...

### Stale Content (N)
- ...

### Index Issues (N)
- ...

### Suggested New Pages (N)
- ...

### Summary
Total issues: N. Auto-fixable: M.
```

## Auto-fix

After presenting the report, offer to auto-fix:
- Add missing pages to the index.
- Remove broken links or create stub pages.
- Add cross-references for orphan pages.

Always ask before deleting or significantly modifying existing content.

## Log

Append to `wiki/log.md`:
```
- [YYYY-MM-DD HH:MM] lint: N issues found, M auto-fixed. Categories: ...
```
