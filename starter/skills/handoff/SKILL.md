---
name: handoff
description: >
  Use when the user wants to compact the current conversation into a handoff
  document so a fresh agent session can pick up the work.
  Triggers: "handoff", "hand this off", "compact this conversation",
  "write a handoff", "continue in a new session", "context is full",
  "pick this up later", "new session for this".
argument-hint: "[what the next session will be used for] [--path <dir>]"
user-invocable: true
disable-model-invocation: true
allowed-tools: Write, Bash(mkdir:*), Bash(date:*), AskUserQuestion
---

# Handoff

Announce: "I'm using the handoff skill to compact this conversation for the next session."

## Step 1: Parse Arguments

Extract from `$ARGUMENTS`:

| Token           | Binding                                     |
| --------------- | ------------------------------------------- |
| `--path <dir>`  | `OUT_DIR=<dir>` — alternate output location |
| Everything else | What the next session will focus on         |

Output goes to a docs directory (default `~/docs/handoffs/`; configurable with `--path`).
If a focus description was passed, tailor the document to it.

## Step 2: Write the Handoff Document

Write `<OUT_DIR>/<timestamp>-<slug>.md` (kebab-case slug from the focus or topic, max 40 chars),
creating the directory first.

Include:

1. **Goal**: what the work is trying to achieve, in one or two sentences.
2. **State**: where the work stands right now — what's done, what's in flight, what's blocked.
3. **Key decisions**: decisions made in this conversation and their rationale.
4. **Open questions**: unresolved questions the next session must answer.
5. **Suggested skills**: which skills the next agent should invoke, in slash-command format (e.g. `` `/research` ``, `` `/debug` ``), and why.
6. **Next actions**: the concrete first steps for the next session.

Rules:

- **Do not duplicate content already captured in other artifacts**
  (specs, plans, ADRs, issues, commits, diffs, RFCs, brainstorm files).
  Reference them by path or URL instead.
- **Redact any sensitive information**: API keys, passwords, tokens, personally identifiable information.
  Write `<REDACTED>` in their place.
- Semantic line breaks: one sentence per line, target 120 characters.

## Step 3: Report

Report the file path and a 3-5 line summary of what the next session should know.
Tell the user to start the next session by pointing the fresh agent at this file.

## Error Handling

When no focus is given, ask:

<interaction>AskUserQuestion(question: "What will the next session be used for?", header: "Focus", multiSelect: false)</interaction>

Free-form answer; no fixed options.

| Error                                             | Action                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| No clear focus for the next session               | Ask what the next session will be used for (see below), then tailor the doc.                                  |
| `--path` directory not writable                   | Report the error and fall back to the default docs directory (`~/docs/handoffs/`) after confirming.           |
| Conversation contains secrets                     | Redact them in the doc and tell the user what was redacted (by category, never the value).                    |
| Handoff depends on uncommitted working-tree state | Call that out explicitly in the State section: uncommitted state does not survive a machine or branch change. |
