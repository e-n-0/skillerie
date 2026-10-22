# CI Validation Loop

This reference describes a bounded check-fix-recheck cycle for failures associated with the current
pull request. Run it only when the user asks for monitoring or chooses it in the parent skill. Stop
after three fix iterations.

## 1. Wait for Checks

Start the poller as a background task:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/poll-ci.sh {number} 30 40
```

It checks immediately, then every 30 seconds for up to 20 minutes. It excludes approval-gated checks
from pending and failure counts.

| State                | Action                                                                             |
| -------------------- | ---------------------------------------------------------------------------------- |
| `ALL_PASSING`        | Report the passing checks.                                                         |
| `FAILURES_DETECTED`  | Read the status file printed by the poller and continue.                           |
| `CONFLICTS_DETECTED` | Use `/fix-conflicts`, then restart monitoring against the updated branch.          |
| `TIMEOUT`            | Report the last summary and pending checks. Do not keep polling in the foreground. |

Do not refetch check data unless the status file is missing or malformed.

## 2. Classify Failures

For each failed check, identify its provider from the link. GitHub Actions links can be inspected with:

```bash
gh run view {run_id} --log-failed
```

When a provider or link is unknown, report the link rather than guessing. Classify the failure:

| Priority | Category       | Typical evidence                                          | Action                                                  |
| -------- | -------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| P0       | Build          | Compilation, missing import, or syntax error              | Fix when the root cause is clear.                       |
| P1       | Test or logic  | Assertion, type error, or incorrect result                | Fix only when evidence identifies the cause.            |
| P2       | Configuration  | Invalid setting or missing environment value              | Ask when the fix depends on local configuration.        |
| P3       | Dependency     | Missing package or version mismatch                       | Inspect the manifest and lockfile before changing them. |
| P4       | Lint or format | Deterministic style violation                             | Use the repository's formatter or linter.               |
| P5       | Infrastructure | Network issue, runner failure, or nondeterministic result | Do not change code; ask before retrying.                |

Compare each failure with the changed-file list from Step 1 of the parent skill. Treat failures outside
the changed files as potentially pre-existing unless the error identifies a changed symbol or behavior.

## 3. Fix and Recheck

Read the relevant error and code before editing. Fix only what the failing check identifies. If multiple
solutions are plausible, ask using an `<interaction>AskUserQuestion(...)</interaction>` block. Never
skip tests, disable checks, or modify unrelated code to make the run green.

Run relevant local tests before asking to publish a fix. Commit and push only if the user requested it.
After a requested push, restart the poller against the new head.

Track the iteration number and attempted failure signatures. Stop when all checks pass, the user
declines a fix, no clear fix remains, the same failure recurs, or three iterations are complete.

## 4. Report

Summarize each iteration's failures, fixes, and outcome. For remaining failures, give the check name,
short evidence, and the next action needed. Include pending checks and the poller's last state.

## Error Handling

| Error                             | Action                                                                   |
| --------------------------------- | ------------------------------------------------------------------------ |
| Check query fails                 | Verify the PR number and `gh auth status`; report the error.             |
| Status file is missing or invalid | Fetch one compact check snapshot and classify from that result.          |
| Poller times out                  | Report its last summary and pending checks.                              |
| Failure is unrelated to the PR    | Report it as potentially pre-existing; do not change this branch for it. |
| Same failure persists after a fix | Stop and report the attempted fix and remaining failure.                 |
