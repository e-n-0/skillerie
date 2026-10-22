---
name: research
description: >
  Use when the user wants a standalone question investigated using primary
  sources, authoritative documentation gathered, or a cited research note
  produced by a background researcher. Not for bug investigation (use `/debug`).
argument-hint: "[question to research] [--path <directory>]"
user-invocable: true
---

# Research

Announce: "I'm using the research skill to investigate this question."

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:

| Token                | Binding                                           |
| -------------------- | ------------------------------------------------- |
| `--path <directory>` | `OUT_DIR=<directory>` — alternate output location |
| Everything else      | The research question                             |

Write the findings in a docs directory (default `~/docs/research/`; configurable
with `--path`).

If no question remains after parsing, ask:

<interaction>
AskUserQuestion(
  header: "Research question",
  question: "What would you like researched?",
  multiSelect: false
)
</interaction>

Continue with the user's answer.

## Step 2: Delegate the Research

Dispatch the `researcher` agent as a background task so you can continue working
while it investigates:

```text
Task(
  subagent_type = "researcher",
  description = "Research: <question>",
  run_in_background = true,
  prompt = "
<question>
<the research question>
</question>

<task>
1. Investigate the question using primary sources only: official documentation,
   source code, specifications, and first-party APIs. Trace each claim to the
   source that owns it; do not use secondary sources when a primary source exists.
2. Write the findings to one Markdown file with inline citations for every claim.
   Cite a URL, file path, or document title as appropriate.
3. Save the file to <OUT_DIR>/<kebab-case-slug>.md, creating the directory if
   needed. Derive a slug from the question, up to 40 characters.
</task>

<format>
- Every factual claim must have a citation. Leave unsupported claims out.
- If no primary source can be found, say so explicitly in the file.
- Use one sentence per line, targeting 120 characters per line.
</format>

<return>
- The output file path
- A 3-5 sentence summary of the findings
</return>"
)
```

## Step 3: Report the Result

When the researcher completes, report the output file path and the researcher's
summary verbatim. Do not paste the full findings into chat; the Markdown file is
the artifact.

If the findings are thin or rely only on secondary sources, say so and ask
whether to dispatch a follow-up pass or accept the findings as-is:

<interaction>
AskUserQuestion(
  header: "Research quality",
  question: "The findings are thin or rely only on secondary sources. What should I do?",
  options: [
    {label: "Follow up", description: "Dispatch another pass focused on primary sources."},
    {label: "Accept", description: "Use the findings as they are."}
  ],
  multiSelect: false
)
</interaction>

If the question needs a design decision rather than research, explain the
mismatch and ask whether to reframe it as a factual research question or stop:

<interaction>
AskUserQuestion(
  header: "Research scope",
  question: "This needs a design decision, not factual research. What would you like to do?",
  options: [
    {label: "Reframe", description: "Choose a factual question to research."},
    {label: "Stop", description: "End this research task."}
  ],
  multiSelect: false
)
</interaction>

## Error Handling

| Error                                                 | Action                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| No question provided                                  | Use the research-question interaction in Step 1.                             |
| Output directory is not writable                      | Report the error and suggest the default docs directory or another `--path`. |
| Researcher task fails                                 | Report the failure and offer to retry or narrow the question.                |
| Findings are thin or cite only secondary sources      | Use the research-quality interaction in Step 3.                              |
| Question is bug-bound                                 | Point the user to `/debug` for the investigation.                            |
| Question needs a design decision rather than research | Use the research-scope interaction in Step 3.                                |
