# New skill template

## Checklist

1. Choose a kebab-case name that describes the task.
2. Confirm the skill belongs in the repository's canonical skill source.
3. Add the required frontmatter fields and a trigger-focused description.
4. Write the announce line, numbered steps, and final error-handling section.
5. Link support files from the entrypoint and keep them one level deep.
6. Run the repository's validation and a behavioral scenario.

## Frontmatter

```yaml
---
name: example-skill
description: >
  Use when the user wants to complete a specific task.
  Triggers: "complete the task", "help with the task", "task workflow".
argument-hint: "[optional task details]"
user-invocable: true
---
```

Only add optional fields when a repository or runtime requires them. In particular,
retain license metadata when it is part of the skill's licensing requirements.

## Body

```markdown
# Example Skill

Announce: "I'm using the example skill to complete the requested task."

## Step 1: Determine the request

Identify the intended result and any constraints that change the approach.

## Step 2: Complete the work

Follow the repository's conventions and verify the observable result.

## Error Handling

| Problem                   | Action                                     |
| ------------------------- | ------------------------------------------ |
| Required input is missing | Ask for the smallest missing detail        |
| Validation fails          | Fix the cause and rerun the relevant check |
```

Replace the example with concrete actions and errors for the actual task.
