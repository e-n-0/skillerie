# Progressive disclosure and file organization

Separate always-loaded instructions from details that are useful only for some tasks.

| Level         | Content                                    | Load pattern                  |
| ------------- | ------------------------------------------ | ----------------------------- |
| Frontmatter   | Name and trigger description               | Used to select the skill      |
| `SKILL.md`    | Core workflow and boundaries               | Loaded when the skill applies |
| Support files | Schemas, examples, and detailed checklists | Read only when needed         |

## Organization

```text
example-skill/
  SKILL.md
  references/
    schema.md
    examples.md
```

Keep support files one level below the entrypoint and link each one explicitly. Group
material by purpose rather than making a large set of tiny files. Do not place unrelated
documentation in a skill directory.

Use a `scripts/` directory only for reusable executable work whose behavior is clearer
and more reliable as code. Keep one-off logic inline. Repeated autonomous polling or
mechanical transformations may benefit from a script; human decisions do not.

## Match detail to task

- Use exact commands and expected results for fragile operations.
- Use numbered steps with branches for workflows that have a small number of paths.
- Use criteria and examples where the correct decision depends on context.
- Keep the entrypoint focused on what most users need.

## Review the layout

Before finishing, verify that every linked support file exists, each file has one clear
purpose, and the common path does not require loading irrelevant references.
