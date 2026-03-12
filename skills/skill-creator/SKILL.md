---
name: skill-creator
description: Create or update a Codex skill with a lean SKILL.md, optional scripts/references/assets, and a workflow that matches the task's fragility. Use when users ask to add a new skill, refine an existing skill, or package repeated know-how into a reusable capability.
---

# Skill Creator

Use this skill when the user wants a reusable Codex skill, not just a one-off answer.

## Outcome

Create or update `skills/<skill-name>/SKILL.md` and only add extra files when they improve reliability or reduce repeated context.

## Workflow

1. Clarify the job the skill should make repeatable.
2. Collect 1-3 concrete examples of the tasks it should handle.
3. Decide the minimum artifact set:
   - `SKILL.md` only for lightweight procedural guidance.
   - `scripts/` when the task needs deterministic execution or repeated code.
   - `references/` for detailed docs that should be loaded only when needed.
   - `assets/` for templates or files used in outputs.
4. Write concise frontmatter:
   - `name`: stable kebab-case identifier.
   - `description`: say what the skill does and when it should be used.
5. Write the body with only the information Codex is unlikely to infer correctly:
   - Trigger condition.
   - Required workflow steps.
   - Tool usage rules.
   - Output expectations.
   - Safety or quality checks.
6. Keep the main file lean. Move long examples, schemas, and variant-specific details into `references/`.
7. Avoid extra docs like `README.md`, `CHANGELOG.md`, or setup notes unless the skill directly needs them.

## Writing Rules

- Prefer short operational instructions over long explanations.
- Match specificity to risk:
  - High freedom for judgment-heavy work.
  - Medium freedom for preferred patterns.
  - Low freedom for fragile sequences.
- Do not restate generic coding advice the model already knows.
- If the skill supports multiple variants, keep selection logic in `SKILL.md` and move per-variant detail into separate reference files.

## Default SKILL.md Shape

```md
---
name: example-skill
description: What it does, and when to use it.
---

# Example Skill

Use this skill when ...

## Workflow

1. ...
2. ...
3. ...

## Guardrails

- ...
- ...
```

## Quality Bar

- The description should be specific enough to trigger reliably.
- The body should stay focused on reusable procedure, not one conversation.
- Bundled files should each have a clear job; if a file is not clearly useful, omit it.
