---
name: wiki-lint
description: Run a health check on the wiki. Finds broken links, contradictions, orphan pages, missing pages, stale content, cross-namespace duplicates, and incomplete cross-references. Use periodically or when the user asks to clean up the wiki.
---

# Wiki Lint

Use this workflow to audit wiki quality and fix issues.

## Namespace Awareness

Check the runtime context for readable namespaces. Lint should check all readable namespaces and cross-namespace references. Pay special attention to `@shared/` consistency.

## Checks

### 1. Broken Links
- Scan all wiki pages across readable namespaces for `[[page-name]]` and `[[@namespace/page-name]]` references.
- Verify each linked page exists in the correct namespace.
- Report broken links with the page, namespace, and line where they appear.

### 2. Orphan Pages
- Find pages with zero inbound `[[links]]` from other pages.
- Suggest where cross-references should be added, or whether the page should be merged/deleted.

### 3. Missing Pages
- Find links that point to non-existent pages.
- Assess whether the page should be created or the link removed.

### 4. Contradictions
- Read pages that cover overlapping topics, including across namespaces.
- Flag where two pages make conflicting claims.
- Note the source attribution for each claim.

### 5. Stale Content
- Compare source summary `updated` dates against `raw/` file modification times.
- Flag pages that may need re-ingestion.

### 6. Index Completeness
- Verify every wiki page in each namespace appears in its `index.md`.
- Verify every `index.md` entry points to an existing file.

### 7. Cross-Namespace Duplicates
- Detect entities or concepts that exist in multiple namespaces with similar content.
- Suggest consolidating into `@shared/` with cross-namespace links.

### 8. Frequently Mentioned Concepts Without Pages
- Scan for terms that appear in 3+ pages but have no dedicated page.
- Suggest creating pages for the most significant ones.

## Output

Produce a lint report organized by check category:
```markdown
## Wiki Lint Report — YYYY-MM-DD

### Namespaces Checked
- @shared, @user-xxx, @dept-xxx

### Broken Links (N)
- ...

### Cross-Namespace Duplicates (N)
- ...

### Summary
Total issues: N. Auto-fixable: M.
```

## Auto-fix

After presenting the report, offer to auto-fix:
- Add missing pages to the index.
- Remove broken links or create stub pages.
- Add cross-references for orphan pages.
- Consolidate duplicates into `@shared/` (ask before proceeding).

Always ask before deleting or significantly modifying existing content.

## Log

Append to each checked namespace's `log.md`:
```
- [YYYY-MM-DD HH:MM] lint: N issues found, M auto-fixed.
```
