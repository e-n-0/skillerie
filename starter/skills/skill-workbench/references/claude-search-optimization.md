# Skill description discoverability

## How selection works

In systems that select skills automatically, the description is commonly inspected
before the full skill body is loaded. A strong description connects the request to the
skill without replacing its instructions.

## Write a trigger-focused description

Use a form such as:

```yaml
description: >
  Use when the user wants to create or improve an agent skill.
  Triggers: "write a skill", "audit skill quality", "improve a skill".
```

Include:

- The problem or intent that should activate the skill.
- Common verbs and alternate phrases users may use.
- A relevant file type or domain when it narrows the match.
- A negative boundary when a nearby task should use something else.

Avoid:

- Summarizing the skill's steps.
- Broad claims such as "helps with projects."
- Trigger lists so broad that unrelated tasks match.

## Test selection quality

Create realistic prompts with enough context to distinguish the intended task from a
near-miss. Test prompts that should select the skill and similar prompts that should not.
Record actual selection results, revise the description, and retest the full set.

Use the repository's available selection mechanism. If it cannot expose selection
results, report that limit instead of inferring a pass.
