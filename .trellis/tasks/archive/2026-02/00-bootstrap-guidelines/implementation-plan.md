# Bootstrap Guidelines - Implementation Plan

## Context

This is a **greenfield MVP project** with:
- ✅ Detailed project spec (Project.md)
- ✅ 3 high-quality Python hooks as style reference
- ❌ No TypeScript/Python source code yet
- ❌ No project config files yet

## Strategy

Since there's **no existing codebase to analyze**, we'll:
1. **Define standards based on Project.md specifications**
2. **Use existing Python hooks as style reference**
3. **Set up industry best practices for TS+Python**
4. **Create minimal but complete guidelines**

## Priority Order (from research agent)

### Phase 1: Core Conventions (Blocking Development)
1. **backend/directory-structure.md** - Define src/, skills/, data/ layout
2. **backend/error-handling.md** - Event error format, API error responses
3. **frontend/type-safety.md** - Core types (Event, Checkpoint, Run)

### Phase 2: Quality Assurance
4. **backend/logging-guidelines.md** - Structured logging aligned with events.jsonl
5. **backend/quality-guidelines.md** - ESLint, Prettier, Python style

### Phase 3: Frontend Development
6. **frontend/component-guidelines.md**
7. **frontend/hook-guidelines.md**
8. **frontend/state-management.md**
9. **frontend/directory-structure.md**

### Phase 4: Completeness
10. **backend/database-guidelines.md** - Mark as N/A (no DB, JSONL only)
11. **frontend/quality-guidelines.md** - Linting, accessibility

## Execution Plan

For each guideline file:
1. **Extract requirements from Project.md**
2. **Reference Python hooks for style patterns**
3. **Add industry best practices**
4. **Include concrete examples**
5. **List anti-patterns**

## Output Format for Each File

```markdown
# [Topic] Guidelines

## Overview
Brief description + why this matters for this project

## Standards
Concrete rules extracted from Project.md

## Code Examples
Real examples (from Project.md or planned structure)

## Anti-patterns
What to avoid and why

## Verification
How to check compliance (commands, tools)
```

## Time Estimate

- Phase 1 (3 files): Core blocking conventions
- Phase 2 (2 files): Quality setup
- Phase 3 (4 files): Frontend development
- Phase 4 (2 files): Completeness

Total: 11 guideline files to fill
