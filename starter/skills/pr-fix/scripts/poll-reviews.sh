#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 4 ]; then
  echo "Usage: $0 <PR number> <owner/repo> <comment-count> <review-count> [bot-pattern] [interval] [max-polls] [log-every] [issue-comment-count]" >&2
  exit 2
fi

PR_NUMBER="$1"
REPO="$2"
KNOWN_COMMENT_COUNT="$3"
KNOWN_REVIEW_COUNT="$4"
BOT_PATTERN="${5:-bot|app|\\[bot\\]}"
POLL_INTERVAL="${6:-30}"
MAX_POLLS="${7:-30}"
LOG_EVERY="${8:-0}"
KNOWN_ISSUE_COMMENT_COUNT="${9:-}"
EYES_ACTIVE=false

for value in "$KNOWN_COMMENT_COUNT" "$KNOWN_REVIEW_COUNT" "$POLL_INTERVAL" "$MAX_POLLS" "$LOG_EVERY"; do
  [[ "$value" =~ ^[0-9]+$ ]] || { echo "Counts and polling options must be non-negative integers." >&2; exit 2; }
done
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

root_comments() {
  gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate 2>/dev/null \
    | jq -s --arg bp "$BOT_PATTERN" '
      add | [
        .[]
        | select((.user.login // "") | test($bp; "i"))
        | select((.in_reply_to_id // null) == null)
        | select(.path != null)
        | {
            comment_id: .id, author: .user.login, path,
            line: (.line // .original_line), body, html_url, commit_id, created_at
          }
      ] | sort_by(.created_at, .comment_id)
    '
}

submitted_reviews() {
  gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate 2>/dev/null \
    | jq -s --arg bp "$BOT_PATTERN" '
      add | [
        .[]
        | select((.user.login // "") | test($bp; "i"))
        | select(.state != "COMMENTED")
        | {review_id: .id, author: .user.login, state, body, html_url, commit_id, submitted_at}
      ] | sort_by(.submitted_at, .review_id)
    '
}

issue_comments() {
  gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate 2>/dev/null \
    | jq -s --arg bp "$BOT_PATTERN" '
      add | [
        .[]
        | select((.user.login // "") | test($bp; "i"))
        | {
            comment_id: .id, author: .user.login,
            body: (.body // ""),
            body_summary: ((.body // "") | split("\n<details>")[0] | gsub("\n+"; " ") | .[0:500]),
            html_url, created_at
          }
      ] | sort_by(.created_at, .comment_id)
    '
}

write_result() {
  local kind="$1"
  local data="$2"
  local file
  file=$(mktemp "${TMPDIR:-/tmp}/pr-fix-review-${kind}.XXXXXX")
  printf '%s\n' "$data" >"$file"
  echo "$file"
}

if ! [[ "$KNOWN_ISSUE_COMMENT_COUNT" =~ ^[0-9]+$ ]]; then
  KNOWN_ISSUE_COMMENT_COUNT=$(issue_comments | jq 'length')
fi

for ((i = 1; i <= MAX_POLLS; i++)); do
  ISSUE_COMMENTS=$(issue_comments || echo "[]")
  EYES_COUNT=$(jq '[.[] | select(.body_summary | test(":eyes:|👀"))] | length' <<<"$ISSUE_COMMENTS")
  PR_BODY=$(gh pr view "$PR_NUMBER" --repo "$REPO" --json body --jq '.body // ""' 2>/dev/null || true)
  if [ "$EYES_COUNT" -gt 0 ] || grep -Eqi ':eyes:|👀' <<<"$PR_BODY"; then
    EYES_ACTIVE=true
    echo "poll $i/$MAX_POLLS: reviewer is investigating"
    [ "$i" -lt "$MAX_POLLS" ] && sleep "$POLL_INTERVAL"
    continue
  fi

  COMMENTS=$(root_comments || echo "[]")
  CURRENT_COMMENTS=$(jq 'length' <<<"$COMMENTS")
  if [ "$CURRENT_COMMENTS" -gt "$KNOWN_COMMENT_COUNT" ]; then
    NEW=$(jq --argjson known "$KNOWN_COMMENT_COUNT" '.[$known:]' <<<"$COMMENTS")
    FILE=$(write_result comments "$NEW")
    echo "REVIEWS_READY"
    echo "NEW_COMMENTS_FILE: $FILE"
    exit 0
  fi

  REVIEWS=$(submitted_reviews || echo "[]")
  CURRENT_REVIEWS=$(jq 'length' <<<"$REVIEWS")
  if [ "$CURRENT_REVIEWS" -gt "$KNOWN_REVIEW_COUNT" ]; then
    NEW=$(jq --argjson known "$KNOWN_REVIEW_COUNT" '.[$known:]' <<<"$REVIEWS")
    FILE=$(write_result reviews "$NEW")
    echo "REVIEWS_READY"
    echo "NEW_REVIEWS_FILE: $FILE"
    exit 0
  fi

  CURRENT_ISSUE_COUNT=$(jq 'length' <<<"$ISSUE_COMMENTS")
  if [ "$CURRENT_ISSUE_COUNT" -gt "$KNOWN_ISSUE_COMMENT_COUNT" ]; then
    NEW=$(jq --argjson known "$KNOWN_ISSUE_COMMENT_COUNT" '.[$known:]' <<<"$ISSUE_COMMENTS")
    FILE=$(write_result issue-comments "$NEW")
    echo "REVIEWS_READY"
    echo "NEW_ISSUE_COMMENTS_FILE: $FILE"
    exit 0
  fi

  if [ "$EYES_ACTIVE" = true ]; then
    echo "REVIEWS_CLEAN"
    echo "eyes_cleared=true new_comments=0 new_reviews=0"
    exit 0
  fi
  if [ "$LOG_EVERY" -gt 0 ] && { [ "$i" -eq 1 ] || [ "$i" -eq "$MAX_POLLS" ] || [ $((i % LOG_EVERY)) -eq 0 ]; }; then
    echo "poll $i/$MAX_POLLS: no new review activity"
  fi
  [ "$i" -lt "$MAX_POLLS" ] && sleep "$POLL_INTERVAL"
done

if [ "$EYES_ACTIVE" = true ]; then
  echo "TIMEOUT"
  echo "Reviewer remained active without completing within $((MAX_POLLS * POLL_INTERVAL / 60)) minutes"
else
  echo "NO_NEW_REVIEWS"
  echo "No reviewer activity after $((MAX_POLLS * POLL_INTERVAL / 60)) minutes"
fi
exit 1
