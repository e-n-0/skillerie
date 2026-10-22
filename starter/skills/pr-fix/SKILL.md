---
name: pr-fix
description: >
  Use when the user wants to address pull request review feedback, fix review comments,
  resolve review threads, or respond to reviewers.
argument-hint: "[PR number, URL, comment URL, or review options]"
user-invocable: true
---

# Fix Pull Request Feedback

Announce: "I'll use the pr-fix skill to address pull request review feedback."

## Routing

| If you need...                               | Use instead          |
| -------------------------------------------- | -------------------- |
| Resolve merge conflicts                      | Use `/fix-conflicts` |
| Fix CI failures unrelated to review feedback | Use `/gh-fix-ci`     |
| Open or update a pull request                | Use `/pr`            |

## Step 1: Gather Context

Parse `$ARGUMENTS` for:

| Input                    | Pattern                                   | Example                                                            |
| ------------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| PR number                | Digits                                    | `42`                                                               |
| PR URL                   | `github.com/<owner>/<repo>/pull/<number>` | `https://github.com/alice/example-project/pull/42`                 |
| Comment URL              | PR URL ending in `#discussion_r<number>`  | `https://github.com/alice/example-project/pull/42#discussion_r123` |
| Reviewer filter          | `--reviewer <login>`                      | `--reviewer alice`                                                 |
| Skip human comments      | `--no-comments`                           | `--no-comments`                                                    |
| Skip automated reviews   | `--no-bot-reviews`                        | `--no-bot-reviews`                                                 |
| Skip CI monitoring       | `--no-ci`                                 | `--no-ci`                                                          |
| Autonomous review and CI | `--auto`                                  | `--auto`                                                           |
| Fully autonomous triage  | `--auto-human`                            | `--auto-human`                                                     |

Run these independent checks in parallel:

```bash
gh auth status 2>&1
gh repo view --json nameWithOwner -q '.nameWithOwner'
git branch --show-current
git status --porcelain=v1 --branch --untracked-files=no
```

If GitHub CLI authentication is missing, tell the user to run `gh auth login` and stop.
If no PR number was supplied, try:

```bash
gh pr view --json number -q '.number' 2>/dev/null
```

If no PR can be identified, ask for its number or URL and stop.

Capture the PR base, merge state, and changed-file list in parallel:

```bash
gh pr view {number} --json baseRefName,mergeable,mergeStateStatus
git diff --name-only origin/{base}...HEAD
```

Keep the changed-file list for classifying failures and scanning for the exact patterns reviewers identify.
If the PR is conflicting, resolve it with `/fix-conflicts` before continuing.

### Option behavior

With no flags, review comments, automated reviews, and CI monitoring are available. Ask before editing
code, triggering an automated review, or starting an auto-fix CI loop.

| Option             | Effect                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `--no-comments`    | Skip human review comments and summaries.                                                                                      |
| `--no-bot-reviews` | Skip triggering and processing automated reviews.                                                                              |
| `--no-ci`          | Skip CI monitoring.                                                                                                            |
| `--auto`           | Skip prompts for automated review and CI choices; human review threads still require direction.                                |
| `--auto-human`     | Also skip prompts for human review threads. Fix clear requests and explain disagreements without changing the disputed design. |

Options compose. If every feature is disabled, say there is nothing to do and stop.

## Step 2: Fetch Review Feedback

Unless `--no-comments` is set, fetch unresolved threads and non-empty review summaries:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/get-pr-comments.sh -a -p {number}
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/get-pr-review-summaries.sh -p {number}
```

For a single comment URL, pass that URL to `get-pr-comments.sh` and skip summaries. If `--reviewer`
is set, pass `-r "{reviewer}"` to both scripts.

If a script returns an object containing `output_file`, use `Read` on that file; do not rerun the request
without `-p`. The comments script returns thread IDs, comment IDs, file paths, line ranges, authors,
resolution state, and comment bodies. A comment URL that cannot be matched to a GraphQL thread may
return a REST result without a thread ID; such a reply cannot resolve the thread.

If there are no threads or summaries, proceed to Step 7.

## Step 3: Categorize and Prioritize

Classify each thread and review summary:

| Category       | Signals                                              | Action                                                                |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------- |
| Suggestion     | Contains a fenced `suggestion` block                 | Apply the suggested change when clear.                                |
| Code change    | Reports a bug or requests a concrete change          | Make the requested fix when clear.                                    |
| Question       | Asks why or requests clarification                   | Prepare a concise technical explanation.                              |
| Disagreement   | Challenges a design or requests a different approach | Do not change disputed behavior without the user's direction.         |
| Outdated       | Thread or comments are marked outdated               | Check current code; resolve only if the concern is already addressed. |
| Review summary | Non-empty review body without an inline thread       | Inspect the current code and act on concrete requests.                |

Prioritize bugs, security problems, breaking changes, and data integrity as P0; clear maintainability
and correctness improvements as P1; style preferences and minor suggestions as P2.

## Step 4: Present Summary and Get Direction

Show the PR title, unresolved thread and summary counts, the P0/P1/P2 findings, and proposed actions.
For disagreements, ask about each one explicitly:

<interaction>
AskUserQuestion(
  header: "Review decision",
  question: "For {path}:{line}, the reviewer requests {summary}. How should I handle it?",
  options: [
    "Fix as requested" — Make the requested change,
    "Explain and keep" — Explain the current design without changing it,
    "Discuss further" — Ask the reviewer for more context and leave the thread unresolved
  ]
)
</interaction>

For other findings, ask whether to fix all or let the user choose individually:

<interaction>
AskUserQuestion(
  header: "Proceed?",
  question: "Ready to address {count} review items ({suggestions} suggestions, {changes} code changes, {questions} explanations)?",
  options: [
    "Fix all" — Address items according to their categories,
    "Let me choose" — Review each proposed action before editing
  ]
)
</interaction>

In `--auto-human` mode, use "Fix all" for clear requests and "Explain and keep" for disagreements.
Do not silently reinterpret an unclear request as a code change.

## Step 5: Apply Changes

Group threads by file and process each file from the highest line number to the lowest to avoid line drift.

For a suggestion block:

1. Extract the suggested code. If there are multiple blocks and the intended one is unclear, use the
   review-decision interaction above to select a block.
2. Read the current file around the comment's line range.
3. Apply the suggestion with `Edit`, adjusting only as needed to fit the current code.

For a code change:

1. Read the current file around the reported lines.
2. Make the smallest change that addresses the comment.
3. If the intended fix remains unclear, ask whether to skip it or apply a stated best-effort interpretation.

For review-summary requests, search changed files first. Search more broadly only when the named symbol
or topic is absent from those files.

After each fix, scan only the other changed files for the exact pattern the reviewer identified. Fix
matching occurrences and note the additional files in the reply.

For explanations, describe the design reason and relevant trade-offs without being defensive. Use
semantic line breaks when replying with multiple sentences, and link relevant code or documentation
when useful.

## Step 6: Reply to Threads

Reply to addressed human threads and resolve them only when the concern is addressed. Prefer the helper:

```bash
printf '%s\n' "{response text}" \
  | bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/reply-review-thread.sh \
      --thread-id "{thread_id}" --first-comment-id "{first_comment_id}" \
      --repo "{owner}/{repo}" --pr "{number}" --path "{path}" \
      --line "{line}" --url "{html_url}" --author "{author}"
```

The helper tries a GraphQL thread reply, a REST threaded reply, then a top-level PR comment. If all
methods fail, report the failure and retain the intended reply in the summary. If a thread ID is absent,
report that the response was posted but the thread could not be resolved.

Use concise replies:

| Category                    | Example                                              |
| --------------------------- | ---------------------------------------------------- |
| Suggestion applied          | `Done — applied the suggestion.`                     |
| Code change                 | `Fixed — {brief description}.`                       |
| Explanation                 | State the technical reason and relevant constraints. |
| Disagreement, fixed         | `Agreed — {brief description of the change}.`        |
| Disagreement, kept          | Explain the reasoning and invite further discussion. |
| Outdated, already addressed | `This was addressed in a subsequent update.`         |

Do not resolve threads when the user chose to discuss further, when the reply asks a question, or when
the comment is from an automated reviewer. For review summaries, post a top-level comment only when code
changed or the reviewer asked a direct question.

## Step 7: Validate and Summarize

Run independent local checks in parallel, chosen from repository guidance and changed file types:

```bash
git diff --check -- {changed-files}
git diff --name-only --diff-filter=U
bash -n {changed-shell-files}
```

Run the relevant tests and format or type checks. Do not commit or push unless the user requested it;
when requested, follow the repository's commit convention and validate before publishing.

If every feature in Step 8 is disabled, proceed to the summary. Otherwise, continue with the enabled
review and CI options.

## Step 8: CI Validation and Automated Reviews

Run the enabled CI and review waiters independently in the background. If either loop changes code,
restart every enabled waiter against the new branch head.

### 8a: Trigger Automated Reviews

Skip if `--no-bot-reviews` is set. Before triggering a new review, find unreplied automated root comments:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/list-unreplied-bot-comments.sh {number} {owner}/{repo}
```

Handle listed comments first. Then compare the latest commit time with the latest automated review time.
If a review is stale, ask whether to trigger a new review, trigger without auto-fixing, or skip. In
`--auto` mode, trigger and use the fix loop in Step 8c.

Capture comment, submitted-review, and top-level-comment baselines before triggering. See
[`references/automated-review-loop.md`](references/automated-review-loop.md) for the baseline queries,
poller states, and iteration rules. Do not wait in this step; continue to CI monitoring.

### 8b: Monitor CI

Skip if `--no-ci` is set. Otherwise ask whether to watch only, watch and fix, or skip. In `--auto` mode,
choose watch and fix. Start the poller in the background:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/poll-ci.sh {number} 30 40
```

On `FAILURES_DETECTED`, read the status file named by the poller and follow
[`references/ci-validation-loop.md`](references/ci-validation-loop.md). Fix only failures clearly
caused by this PR. Retry a flaky job only when the user chooses to retry; do not change code to mask
infrastructure failures. Stop after three fix iterations or when the same failure recurs.

### 8c: Process Automated Review Feedback

If a review was triggered, start the review poller in the background with the captured baselines:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/poll-reviews.sh \
  {number} {owner}/{repo} "$REVIEW_BASELINE_COMMENTS" "$REVIEW_BASELINE_REVIEWS" \
  "$BOT_PATTERN" 30 30 0 "$REVIEW_BASELINE_ISSUE_COMMENTS"
```

On `REVIEWS_READY`, inspect only the reported new-comment or review files. Address concrete, clear
requests; leave design disagreements and ambiguous items for the user. Reply to automated comments
without resolving their threads. Stop after three iterations. On `REVIEWS_CLEAN`, report the clean
result; on `NO_NEW_REVIEWS` or `TIMEOUT`, report that the reviewer did not finish.

## Step 9: Final PR Summary

After enabled waiters and fix loops finish, capture the current PR state:

```bash
gh pr checks {number} --json name,state,bucket,description,link
gh pr view {number} --json mergeable,mergeStateStatus
```

Report relevant sections only:

- Resolved, replied, review summaries, and unresolved items, with counts and brief outcomes.
- Files changed and commits created during this run, if any.
- CI results, including pending or skipped checks.
- Automated review results, including new actionable feedback or reviewer timeouts.
- Next steps; say the PR is ready for re-review only when addressed comments and current checks support it.

## Error Handling

| Error                           | Action                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------- |
| GitHub CLI is not authenticated | Tell the user to run `gh auth login`; stop.                                  |
| PR cannot be found              | Check the supplied number or URL and report the failure.                     |
| No unresolved feedback          | Skip to the enabled CI and review options.                                   |
| Comment fetch fails             | Try the REST review-comment endpoint; report missing thread-resolution data. |
| Review summary fetch fails      | Try the REST reviews endpoint and keep non-empty review bodies.              |
| Large result                    | Read the path returned in `output_file`; do not rerun an unbounded request.  |
| Reply or resolution fails       | Report which operation failed and continue with other items.                 |
| Comment line is outdated        | Find the relevant code by context and report if it is already addressed.     |
| CI poller times out             | Report its last summary and pending checks; do not poll in the foreground.   |
| Fix iteration limit is reached  | Stop and list the remaining failures or comments.                            |
| Same failure recurs after a fix | Do not repeat the same fix; report it as unresolved.                         |
| Merge conflicts remain          | Use `/fix-conflicts` or request manual resolution.                           |
