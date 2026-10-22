# Planning checklist

- Identify the affected behavior and its callers.
- Choose a small, reviewable change.
- Name the checks that prove the result.

Use `find '/home/alice/notes' -name '*.md'` to list notes.
Use `find "$DIR" -name '*.md'` to list runtime notes.
- `find . \( -path './skills/*/SKILL.md' -o -path './*/skills/*/SKILL.md' \)`
Use `grep -rnE --include='*.ts' -- 'TODO' "$DIR"` to search sources.

```text
exec_command({"cmd":"grep -rnE --include='*.ts' -- 'TODO' 'src'"})
spawn_agent({"agent_type":"explorer","message":"Inspect the parser."})
```
