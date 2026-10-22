# Automated Review Loop

This reference describes how to trigger configured automated reviewers, collect only new feedback,
and process actionable comments. Run this loop only when the user requests it or selects it in the
parent skill. Limit each reviewer to three iterations.

## 1. Capture a Baseline and Trigger

Before triggering a review, record the number of root file comments, submitted reviews, and top-level
issue comments from the reviewer. The baseline must be captured before posting the trigger:

```bash
BOT_PATTERN="${BOT_PATTERN:-bot|app|\[bot\]}"
REVIEW_BASELINE_COMMENTS=$(
  gh api "repos/{owner}/{repo}/pulls/{number}/comments" --paginate \
    | jq -s --arg bp "$BOT_PATTERN" \
      'add | [.[] | select((.user.login // "") | test($bp; "i")) |
       select((.in_reply_to_id // null) == null) | select(.path != null)] | length'
)
REVIEW_BASELINE_REVIEWS=$(
  gh api "repos/{owner}/{repo}/pulls/{number}/reviews" --paginate \
    | jq -s --arg bp "$BOT_PATTERN" \
      'add | [.[] | select((.user.login // "") | test($bp; "i")) |
       select(.state != "COMMENTED")] | length'
)
REVIEW_BASELINE_ISSUE_COMMENTS=$(
  gh api "repos/{owner}/{repo}/issues/{number}/comments" --paginate \
    | jq -s --arg bp "$BOT_PATTERN" \
      'add | [.[] | select((.user.login // "") | test($bp; "i"))] | length'
)
```

Use a reviewer trigger supported by the repository. For example:

```bash
gh pr comment {number} --body "@{reviewer} review"
```

Do not trigger reviewers that are not configured for the repository. If a reviewer timed out on an
earlier iteration, skip it on later iterations.

## 2. Wait in the Background

Use the bundled poller, launched as a background task:

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/pr-fix/scripts/poll-reviews.sh \
  {number} {owner}/{repo} "$REVIEW_BASELINE_COMMENTS" "$REVIEW_BASELINE_REVIEWS" \
  "$BOT_PATTERN" 30 30 0 "$REVIEW_BASELINE_ISSUE_COMMENTS"
```

The poller checks immediately, then every 30 seconds for up to 15 minutes. Do not replace it with a
foreground sleep loop.

| State            | Action                                                                       |
| ---------------- | ---------------------------------------------------------------------------- |
| `REVIEWS_READY`  | Read the file paths printed for new comments or reviews; continue to Step 3. |
| `REVIEWS_CLEAN`  | Read the new issue-comment file if present and report the clean result.      |
| `NO_NEW_REVIEWS` | Report that no response arrived; skip this reviewer for later iterations.    |
| `TIMEOUT`        | Report that a reviewer remained active without finishing.                    |

## 3. Inspect New Feedback

Use only the new data files from the poller. If an output file is missing or malformed, fetch compact
root comments for the configured reviewer:

```bash
gh api "repos/{owner}/{repo}/pulls/{number}/comments" --paginate \
  | jq -s --arg bp "$BOT_PATTERN" \
    'add | [.[] | select((.user.login // "") | test($bp; "i")) |
     select((.in_reply_to_id // null) == null) | select(.path != null) |
     {comment_id: .id, path, line: (.line // .original_line), body,
      author: .user.login, html_url, commit_id}]'
```

Skip summaries, praise, and comments without a concrete request. For each actionable item, read the
current code and classify it:

- Clear correctness or style issue: make only the requested fix.
- Architectural disagreement or ambiguous request: do not change code; leave it for the human author.
- Suggested code block: apply only when its intended target is clear.

Process files in order and comments bottom-to-top within each file. Never suppress tests or disable checks.

## 4. Validate, Reply, and Repeat

Run relevant tests and local checks after fixes. Do not commit or push unless the user requested it.
Reply to each processed comment with the outcome and, if available, the commit that contains the fix.
Do not resolve automated-review threads.

Stop when no actionable comments remain, the iteration limit is reached, no fixes are appropriate, or
the reviewer is unavailable. Report remaining items and the reason each was left open.

## Error Handling

| Error                                | Action                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Trigger comment fails                | Check access and report the failure; skip that reviewer.               |
| Poller times out                     | Report the timeout and continue with other enabled work.               |
| Reply fails                          | Report the failure and retain the intended reply in the final summary. |
| A fix fails validation               | Diagnose the failure before proceeding; do not suppress the check.     |
| The same request returns after a fix | Do not repeat the same change; report it for human review.             |
