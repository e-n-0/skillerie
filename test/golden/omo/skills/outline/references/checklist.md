# Planning checklist

- Identify the affected behavior and its callers.
- Choose a small, reviewable change.
- Name the checks that prove the result.

Use `find '/home/alice/notes' -name '*.md'` to list notes.
Use `find "$DIR" -name '*.md'` to list runtime notes.
- `find . \( -path './skills/*/SKILL.md' -o -path './*/skills/*/SKILL.md' \)`
Use `grep -rnE --include='*.ts' -- 'TODO' "$DIR"` to search sources.
ask_user_question({"questions":[{"question":"Choose a worktree?\nPopulate real label/description choices from [one entry per worktree] before asking.","header":"Worktree","multiSelect":false,"options":[]}],"waitForAnswer":true})

```text
bash({"command":"grep -rnE --include='*.ts' -- 'TODO' 'src'"})
```
