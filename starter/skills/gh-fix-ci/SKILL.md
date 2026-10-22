---
name: gh-fix-ci
description: >
  Use when the user wants to investigate or fix failing GitHub Actions checks on
  a pull request; inspect runs and logs with `gh`, summarize the evidence, and
  propose a focused fix before editing.
argument-hint: "[PR number or URL]"
user-invocable: true
---

# Fix failing GitHub Actions checks

Announce: "I'll inspect the failing GitHub Actions checks and propose a focused fix."

## Overview

Inspect failing pull request checks, collect relevant GitHub Actions logs, summarize
the evidence, and propose a focused fix plan. Do not edit files until the user
explicitly approves the plan.

## Step 1: Verify access and resolve the pull request

Run `gh auth status` from the repository. If the GitHub CLI is unavailable or
unauthenticated, tell the user to install or authenticate it with `gh auth login`,
then stop.

Use the PR number or URL from `$ARGUMENTS` when supplied. Otherwise, resolve the
pull request for the current branch:

```bash
gh pr view --json number,url
```

If no pull request can be identified, ask for its number or URL and stop.

## Step 2: Inspect failing checks

Run the bundled helper from the skill directory:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/gh-fix-ci/scripts/inspect_pr_checks.py" \
  --repo "." --pr "<number-or-url>"
```

Add `--json` for structured output:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/gh-fix-ci/scripts/inspect_pr_checks.py" \
  --repo "." --pr "<number-or-url>" --json
```

The helper checks authentication, resolves the pull request when needed, handles
available-field differences in `gh pr checks`, and fetches run metadata and logs.
It reports checks without a GitHub Actions run as external and does not fetch
their logs.
The helper returns status 1 both when failures are found and when inspection
cannot be completed, so read its output before treating a nonzero status as an
inspection error.

If the helper is unavailable or fails, inspect checks manually:

```bash
gh pr checks "<number-or-url>" \
  --json name,state,bucket,link,startedAt,completedAt,workflow
```

If `gh` rejects a requested field, rerun using the available fields it reports.
For each failed GitHub Actions check, inspect its run:

```bash
gh run view "<run-id>" \
  --json name,workflowName,conclusion,status,url,event,headBranch,headSha
gh run view "<run-id>" --log
```

If run logs are not available yet and a job ID is available, try that job's log:

```bash
gh run view --log --job "<job-id>"
```

For checks not backed by a GitHub Actions run, report the check name and details
URL only. Do not attempt to query another provider.

## Step 3: Summarize the evidence

For each failing check, report its name, run URL when available, status, and the
smallest useful log excerpt that supports the likely cause. Distinguish a code
failure from missing or pending logs and infrastructure problems. Say explicitly
when logs could not be retrieved; do not infer a cause from a check name alone.

## Step 4: Propose a fix and get approval

Draft a concise plan based on the log evidence. Identify which failures appear
caused by this pull request and what tests or checks will validate the proposed
change. Do not edit files, trigger retries, or start an automated fix loop before
the user approves.

<interaction>
AskUserQuestion(
  header: "Fix plan",
  question: "Should I implement this proposed fix for the pull request?",
  options: [
    "Implement plan" -- Apply the proposed changes and run focused validation,
    "Revise plan" -- Adjust the approach before changing files
  ]
)
</interaction>

If the user declines or asks to revise the plan, do not edit until they approve
the revised plan.

## Step 5: Implement and recheck

After approval, make only the approved changes. Run the relevant tests and checks,
then inspect the pull request status again:

```bash
gh pr checks "<number-or-url>"
```

Report the files changed, tests run, and resulting check status. If a failure is
flaky or caused by infrastructure, explain the evidence and ask before retrying
the job. Do not change code to hide an unrelated failure.

Use `/pr-fix` for pull request review feedback and `/fix-conflicts` for merge
conflicts.

## Error Handling

- **GitHub CLI is missing or unauthenticated:** Tell the user to install or
  authenticate it, then stop.
- **Pull request cannot be resolved:** Ask for a valid number or URL.
- **No failing checks:** Report that none were detected and stop.
- **Check fields differ:** Use the fields reported by `gh` and retry the query.
- **Logs are pending or unavailable:** Report that explicitly; do not guess at
  the cause.
- **Check is not a GitHub Actions run:** Report its name and details URL only.
- **Failure appears flaky or infrastructure-related:** Ask before retrying; do
  not mask the failure with a code change.
- **Merge conflicts block the fix:** Use `/fix-conflicts` before continuing.
