# Skill writing best practices

## Core principles

| Principle      | Practice                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Concise        | Keep one idea per sentence and remove repeated context                     |
| Specific       | Name the action and expected result instead of using vague verbs           |
| Self-contained | Include enough context to use the skill without external memory            |
| Scannable      | Put the common path early and use headings, lists, or tables               |
| Flexible       | Give exact commands for fragile operations and criteria for judgment calls |

## Match detail to risk

| Freedom | Use for                                              | Instruction style                    |
| ------- | ---------------------------------------------------- | ------------------------------------ |
| Low     | Destructive actions, strict formats, required checks | Exact sequence and observable result |
| Medium  | Multi-step work with a few valid branches            | Steps with decision points           |
| High    | Context-dependent evaluation                         | Principles and selection criteria    |

## Description

The description is the trigger for loading a skill. Start with `Use when`, name the
user's intent, and include realistic trigger phrases. Describe when to use the skill, not
the sequence it follows. Keep it short enough to scan.

## Structure

- Put the common workflow near the beginning.
- Use copyable examples when syntax matters.
- Explain why a non-obvious step improves the result.
- Link detailed guidance from the entrypoint instead of nesting references deeply.
- Keep terminology consistent.
- Include an error path for actions that can fail.

## Avoid

| Pattern                                   | Better choice                                          |
| ----------------------------------------- | ------------------------------------------------------ |
| Filler words                              | Remove words that add no instruction                   |
| Vague verbs such as "handle" or "process" | Name the operation and its result                      |
| Long narrative examples                   | Show the reusable pattern with a short neutral example |
| Many alternatives without a default       | Recommend a default and explain when to choose another |
| Repeating general model knowledge         | Include only task-specific guidance                    |
| Overfitting to one test                   | Fix the underlying ambiguity or missing rule           |

## Validation loop

For workflows with multiple stages, check each important output before proceeding. When
validation fails, fix the specific cause and rerun that check. Set a reasonable iteration
limit and report any unresolved issue.
