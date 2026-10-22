---
name: debug
description: "Use when investigating a bug, failing test, unexpected behavior, or performance regression before changing code."
argument-hint: "[bug description, error, failing test, or optional --path <directory>]"
user-invocable: true
---

# Systematic Debugging

Announce: "I'm using the debug skill to investigate the issue before proposing a fix."

## The Rule

> Do not change code until the root cause is supported by evidence.

Reproduce the reported symptom, build a reliable feedback loop, and test hypotheses
before implementing a fix. A plausible explanation is not a confirmed cause.

## When to Use the Full Process

Use this workflow for failing tests, unexpected behavior, performance regressions,
build failures, integration problems, intermittent failures, and data corruption.
Follow it especially when a fix seems obvious, time is short, or earlier attempts
have not worked.

## Red Flags

Stop and return to investigation if you catch yourself thinking:

- "Let me just try this change."
- "I do not need to reproduce it."
- "The error message tells me everything."
- "I will investigate after applying the quick fix."
- "Several changes at once will be faster."

## Step 1: Start or Resume a Debug Session

Use `$ARGUMENTS` and the conversation to decide whether to resume an existing
debug session or start a new one. If the arguments identify a state file, read it
and continue at the recorded phase.

For a new session, accept an optional `--path <directory>` value as the state
root. Store session state in a docs directory (default `~/docs/debug/`;
configurable with `--path <directory>`). Create a child directory named
`<timestamp>-<short-description>` and put `DEBUG.md` inside it.

Use this frontmatter for a new state file:

```yaml
---
session_id: <timestamp-and-slug>
status: investigating
phase: REPRODUCING
created: <ISO timestamp>
last_updated: <ISO timestamp>
---
```

Keep the file useful as a resumable log. Record the original report, exact
reproduction steps, observations, ranked hypotheses, confirmed root cause, fix,
and verification. Append investigation entries rather than rewriting history.
Update `last_updated` and `phase` whenever the session changes phase.

Suggested sections:

```markdown
# Debug Session: <brief description>

## Bug Report

<reported symptom, error output, and relevant context>

## Reproduction

- [ ] Reproduced reliably
- Steps: <pending>
- Environment: <pending>

## Investigation Log

<!-- Append observations and commands tried. -->

## Hypotheses

<!-- Ranked, falsifiable explanations with status and evidence. -->

## Root Cause

<pending until confirmed>

## Fix

<pending until implemented>

## Verification

<pending until checked>
```

If the state directory cannot be created or written, report the error and ask for
a writable path. Do not silently switch to another location.

## Step 2: Reproduce and Build a Tight Feedback Loop

Read the full error output, including stack traces, warnings, and surrounding
context. Run the failing command or test exactly as reported and capture its
complete output.

Build a short, repeatable check that exercises the same code path and asserts the
reported symptom. Useful options include:

1. A failing unit, integration, or end-to-end test.
2. A request against a controlled test endpoint.
3. A command-line run with a fixture and a known-good output to compare.
4. A browser script that asserts on the visible result, console, or network.
5. A replay of a captured request, payload, or event.
6. A small harness that invokes the failing path with minimal dependencies.
7. A property or fuzz test for incorrect output across many inputs.
8. A bisection harness when the issue appeared between known revisions.
9. A differential check across versions or configurations.
10. A human-guided loop using `scripts/hitl-loop.template.sh` when no unattended
    check can exercise the behavior.

Treat the loop as a product:

- Make it fast by narrowing setup and unrelated work.
- Make its assertion specific to the user-visible failure.
- Make it deterministic by controlling inputs, time, randomness, filesystem
  state, and network dependencies where practical.
- Make it runnable without manual steps whenever possible.

For intermittent failures, increase the reproduction rate with controlled
repetition or stress. Record the observed rate and synchronize on relevant events;
do not rely on arbitrary delays.

The loop is ready when you can name one command you have already run and:

- It can fail on the reported symptom and pass after a correct fix.
- It is deterministic, or its intermittent rate is measured and high enough to
  distinguish outcomes.
- It finishes quickly enough to run during each investigation cycle.
- It can run unattended, except for a deliberate human-guided step.

Run the loop and confirm it reproduces the user's reported failure, not a nearby
or unrelated error. Then minimize the case one input, caller, configuration value,
or step at a time, rerunning the loop after every reduction. Keep only elements
whose removal makes the loop pass.

If a local or test reproduction cannot be built, list what you tried and request
the smallest missing input: access to an approved reproduction environment or a
redacted artifact such as a log, request capture, crash dump, or recording.
Do not invent a theory in place of a missing reproduction.

<interaction>
AskUserQuestion(
  header: "No reproduction",
  question: "I cannot build a reliable reproduction with the available information. What should I use next?",
  options: [
    { label: "Provide access", description: "Provide approved access to the environment where the issue occurs." },
    { label: "Share artifact", description: "Provide a redacted capture that reproduces or explains the issue." },
    { label: "Pause", description: "Stop until a reproducible case or more context is available." }
  ]
)
</interaction>

Do not proceed to hypothesis testing until a useful feedback loop exists. If
reproduction remains impossible, record the limitation and proceed only with
clearly labeled observations, not an asserted root cause.

## Step 3: Gather and Trace Evidence

Map the relevant code path from the observed failure back to its trigger. Start
with the code that produced the symptom, then follow callers and values backward.
At each level, inspect the actual code and verify the values rather than inferring
what they must be.

For a broad codebase, use a read-only explorer to identify:

1. The call chain from entry point to failure.
2. Values passed through the failing path.
3. Related tests and what they cover.
4. Recent changes to the relevant files.
5. Similar working paths for comparison.

Keep direct observations separate from hypotheses and cite `file:line` for
findings. If an external API, library, or unfamiliar behavior is involved, consult
its authoritative documentation or a focused researcher before concluding.

For code exploration, delegate a focused, read-only map:

```text
Task(
  subagent_type = "explorer",
  description = "Map the code path for <issue>",
  prompt = "
  <context>
  <reported behavior, error output, and reproduction steps>
  </context>

  <task>
  Trace from the symptom to its original trigger. Report the call chain, values
  passed at each step, related tests, recent changes, and similar working paths.
  Cite each finding with file:line and separate observations from hypotheses.
  </task>"
)
```

When external behavior needs confirmation, use a focused research request:

```text
Task(
  subagent_type = "researcher",
  description = "Research the behavior of <library or API>",
  prompt = "
  Check authoritative documentation and relevant version notes for <specific
  behavior>. Return findings with sources; do not propose a code change."
)
```

For a possible change in recent history, inspect the relevant revisions. If the
regression range is known, use the reproduction command as the bisection check.

Use backward tracing to find the original trigger. For the detailed technique,
see `references/root-cause-tracing.md`.

## Step 4: Form and Test Hypotheses

Write three to five ranked hypotheses before testing any. Each must make a
falsifiable prediction: if this explanation is correct, what observable result
should change when one variable is changed?

Show the ranked list to the user before testing. Incorporate useful domain
knowledge, but do not block on a response when the evidence supports continuing.

Test one hypothesis at a time. Change one variable per experiment and record the
command, result, and conclusion. When temporary instrumentation is needed, give
each diagnostic log a unique prefix and remove all such logs before completion.
Prefer a debugger or breakpoint when available. For performance issues, measure
a baseline before changing code.

Mark each hypothesis `CONFIRMED`, `REJECTED`, or `UNTESTED` and include the
evidence. Do not move to implementation until one root cause is confirmed.
If none is confirmed, return to evidence gathering and revise the hypotheses.

## Step 5: Analyze the Fix Context

Before editing:

1. Find a similar code path that works and compare it with the failing path.
2. Check for the same faulty pattern in other callers or modules.
3. Identify dependencies and behavior that could be affected by a change.
4. Record the evidence that links the confirmed cause to the proposed fix.

The root cause is often visible in a difference between the working and failing
paths: arguments, validation, error handling, conversions, or initialization.

## Step 6: Implement One Focused Fix

Write a regression test before the fix when there is a test seam that exercises
the real failure path. Run it and confirm it fails for the expected reason. Use
the minimized reproduction as the test case when possible.

If no test seam can reproduce the failure, document that limitation and identify
what testability change would be needed. If a test is not feasible, describe the
manual verification and why it is necessary.

Make one minimal change that addresses the confirmed cause. Avoid unrelated
cleanup. For a substantial implementation, delegate only the isolated change,
providing the confirmed cause, evidence, intended fix, relevant code paths, and
constraints. Require the implementer to run the regression test and related
checks; review the result against the same evidence:

```text
Task(
  subagent_type = "implementer",
  description = "Implement the confirmed fix for <issue>",
  prompt = "
  <root_cause>
  <confirmed cause and supporting evidence>
  </root_cause>

  <fix>
  <one minimal change that addresses the cause>
  </fix>

  Implement only this fix. Run the regression test and relevant checks. Return
  the changed paths and the exact verification results."
)
```

Add validation at intermediate layers only when it is proportional to the issue.
See `references/defense-in-depth.md`.

## Step 7: Verify and Update the Session

Prove the fix against both the regression and the original report:

1. Run the regression test and confirm it now passes.
2. Run the relevant broader test suite.
3. Rerun the original feedback loop against the unminimized scenario.
4. Check important adjacent cases.
5. Remove temporary instrumentation and throwaway harnesses.

Record the exact commands and outcomes in `DEBUG.md`. Set `phase: VERIFIED`,
`status: resolved`, and update `last_updated` only when the evidence supports
resolution.

If verification fails, record the attempt and return to investigation. After
three unsuccessful fix cycles, stop cycling through patches; revisit the
architecture and present the evidence and remaining options.

## Step 8: Report

Present a concise summary:

```markdown
## Debug Summary

**Bug:** <one-line description>
**Root cause:** <confirmed explanation>
**Fix:** <focused change>
**Verification:** <commands and results>
**Additional validation:** <what was added, or none>
**Session file:** <path to DEBUG.md>
```

## Error Handling

| Situation                       | Action                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Cannot reproduce                | List attempts and request the missing access or a redacted artifact.             |
| Root cause remains unclear      | Record observations, share ranked hypotheses, and request useful domain context. |
| Fix causes new failures         | Record the result, return to analysis, and revise the fix based on evidence.     |
| Three fix cycles fail           | Stop patching and present the investigation for an architectural review.         |
| State file is missing           | Report it and offer to start a new session.                                      |
| State directory is not writable | Report the error and request a writable location.                                |
| Failure is intermittent         | Measure the reproduction rate and use controlled repetition or stress.           |
