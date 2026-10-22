---
name: skill-workbench
description: >
  Use when the user wants to create, audit, test, or improve agent skills.
  Triggers: "create a skill", "write a skill", "audit skills", "improve a skill",
  "skill quality", "skill workbench".
argument-hint: "[create <name> | improve <name|docs|tools>]"
user-invocable: true
---

# Skill Workbench

Announce: "I'm using the skill workbench to create or improve an agent skill."

## Step 1: Scope and Route

Identify the repository root and read its contributor instructions before editing:

```bash
git rev-parse --show-toplevel
```

Inspect the repository's skill, agent, and plugin conventions. Do not assume it uses a
particular layout or plugin system.

Choose a mode from the user's arguments and conversation:

| Signal                              | Mode                                     |
| ----------------------------------- | ---------------------------------------- |
| `create <name>`                     | Create a skill                           |
| `improve <target>` or a named skill | Improve or audit a skill                 |
| No arguments                        | Ask which mode and target the user wants |

If there is no skill infrastructure, explain that and ask whether to create the initial
structure. Keep all edits in canonical source directories; do not edit installed copies,
generated output, or caches.

When the mode or target cannot be inferred, ask one focused question:

<interaction>
AskUserQuestion(
  header: "Skill task",
  question: "What should I work on?",
  options: [
    {label: "Create a skill", description: "Write a new skill from a concrete workflow"},
    {label: "Improve a skill", description: "Audit or revise an existing skill"}
  ],
  multiSelect: false
)
</interaction>

## Step 2: Create a Skill

### 2a. Gather requirements

Use the conversation and repository to resolve details before asking. Determine:

- A kebab-case skill name, no longer than 64 characters.
- The task it helps with and the requests that should trigger it.
- The intended user, input, output, and important boundaries.
- Whether users should invoke it directly.
- The repository's canonical location and validation commands.

Ask only for missing decisions that materially change the skill. Keep the skill
self-contained and avoid adding speculative features.

### 2b. Research and plan

Read similar skills and relevant repository guidance. Search external documentation only
when the skill covers a domain that is unfamiliar or changes over time.

Before writing, outline the workflow, affected files, and acceptance criteria. Select
specific instructions for fragile actions and room for judgment where the task depends
on context.

### 2c. Write the skill

Use the repository's canonical skill directory. In a skillerie config repository, that
is `skills/<name>/`; in other repositories, follow their documented source layout.
Create `SKILL.md` with the required frontmatter fields:

```yaml
---
name: example-skill
description: >
  Use when the user wants to perform a clearly scoped task.
  Triggers: "do the task", "help with the task", "task workflow".
argument-hint: "[optional input]"
user-invocable: true
---
```

Keep optional metadata only when the runtime or repository needs it. Use canonical
Claude-style tool names in authored examples. Wrap user questions in
`<interaction>AskUserQuestion(...)</interaction>` blocks. Write skill references as
backtick-quoted `/<name>` and verify each one resolves in the active skill set.

Follow this structure:

1. An `Announce:` line immediately after the title.
2. Numbered `## Step N:` sections with observable actions.
3. A final `## Error Handling` section with specific recovery steps.

Write for the skill's task type:

| Type                     | Writing approach                                              |
| ------------------------ | ------------------------------------------------------------- |
| Workflow or technique    | Explain why each non-obvious step helps                       |
| Discipline or validation | State critical requirements plainly and close known loopholes |
| Reference                | Present accurate facts without persuasion                     |

Keep the entrypoint concise and move detailed examples, schemas, or checklists to
one-level-deep files under `references/`. Link each support file from the entrypoint and
say when to read it. Put reusable scripts under `scripts/` only when they perform
repeatable work more reliably than instructions.

Use neutral examples: `example.com`, the user `alice`, paths under `/home/alice` or
temporary directories, and servers named `docs` or `tracker`. Do not include private
accounts, machine paths, credentials, internal endpoints, or employer-specific tools.
Keep any existing third-party license file alongside the skill it covers.

### 2d. Test the skill

Test behavior, not just formatting. Use a realistic scenario that exercises the skill's
main promise and at least one likely edge case.

1. **Baseline:** run the scenario without the new skill and record concrete failures or
   missed requirements.
2. **With the skill:** run the same scenario with the skill loaded and compare its
   behavior against the baseline.
3. **Revise:** address general instruction gaps, then repeat the same scenario.
4. **Review:** read the full run transcript when available; final output alone can hide
   confusion or skipped steps.

Use a `Task` subagent when available. Keep the scenario and inputs identical between
runs. Do not claim a test passed unless you observed its result. See
[references/testing-with-subagents.md](references/testing-with-subagents.md).

### 2e. Check discoverability

Write 20 realistic prompts: 10 that should trigger the skill and 10 adjacent requests
that should not. Use varied wording and enough context to distinguish real requests
from keyword matches.

Show the prompts to the user before running trigger tests. Test them with the repository's
available skill-selection mechanism, record each result, and revise the description for
misses or false positives. Limit description tuning to three full iterations, then report
any remaining failures. See
[references/claude-search-optimization.md](references/claude-search-optimization.md).

### 2f. Validate and integrate

Run the repository's relevant skill checks. If none exist, manually verify:

- The frontmatter parses and contains the required fields.
- The skill name matches its directory and uses kebab-case.
- Every `/<skill>` reference resolves in the active skill set.
- Every linked support file exists and is one level below the skill directory.
- The steps, announce line, and final error-handling section are present.
- The skill is concise and contains no private or machine-specific details.

Update a manifest, index, or documentation only when the repository requires it. Read
[references/skill-quality-checklist.md](references/skill-quality-checklist.md) before
finishing.

## Step 3: Improve or Audit Existing Skills

### 3a. Set the scope

Resolve the target from the request:

| Target     | Scope                                        |
| ---------- | -------------------------------------------- |
| Skill name | That skill and its support files             |
| `docs`     | Skill documentation and relevant indexes     |
| `tools`    | Skill tooling and validation configuration   |
| No target  | Skills named by the user or clearly in scope |

Read every relevant file, including `references/`, scripts, assets, and metadata. Do not
review only `SKILL.md`. For a broad audit, record findings as
`file | dimension | specific issue`.

### 3b. Evaluate

Check each skill for:

- **Clarity:** concrete actions, stated inputs, and visible outcomes.
- **Completeness:** likely errors, edge cases, and recovery paths.
- **Conciseness:** repeated guidance, unnecessary explanation, and oversized entrypoints.
- **Consistency:** repository conventions, required structure, and accurate cross-references.
- **Organization:** useful progressive disclosure and valid support-file links.
- **Discoverability:** a trigger-focused description that starts with `Use when`.
- **Examples:** realistic neutral fixtures with no private information.

Use [references/best-practices.md](references/best-practices.md) and
[references/progressive-disclosure.md](references/progressive-disclosure.md) when the
review needs those criteria.

### 3c. Fix and test

Fix the cause of each in-scope issue, prioritizing broken behavior, missing steps, and
invalid references before polish. Generalize from test failures instead of adding
case-specific wording.

Choose a behavioral test that exercises the changed workflow. For major process or
discipline changes, compare a baseline without the changed skill against a run with it.
For reference changes, test retrieval and use of the updated information. Formatting-only
changes need structural validation.

### 3d. Validate

Run relevant repository checks once after the edits. If the repository has no checks,
apply the manual validation list in Step 2f. Investigate failures; do not weaken a useful
check to make the skill pass.

## Step 4: Report

Summarize the skills changed, the reason for each change, validation performed, and any
remaining issue. Use
[references/report-template.md](references/report-template.md) when a structured report
is useful. Do not claim unrun tests or checks.

## Error Handling

| Problem                                         | Action                                                                                    |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Skill name already exists                       | Confirm whether to improve it or choose another name                                      |
| Required context is missing                     | Ask one focused question before making the affected decision                              |
| A support file is missing                       | Continue with concise inline guidance or recreate it from verified repository conventions |
| Validation fails                                | Fix the reported cause and rerun the relevant check                                       |
| A reference points outside the active skill set | Replace it with a valid reference or remove it                                            |
| A third-party license is present                | Keep it beside the covered skill and preserve required attribution                        |
| A requested target is installed or generated    | Find and edit its canonical source instead                                                |
