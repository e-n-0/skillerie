#!/usr/bin/env bash
set -euo pipefail

THREAD_ID=""
FIRST_COMMENT_ID=""
REPO=""
PR_NUMBER=""
COMMENT_PATH=""
COMMENT_LINE=""
COMMENT_URL=""
COMMENT_AUTHOR=""
RESOLVE=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --thread-id) THREAD_ID="${2:-}"; shift 2 ;;
    --first-comment-id) FIRST_COMMENT_ID="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --pr) PR_NUMBER="${2:-}"; shift 2 ;;
    --path) COMMENT_PATH="${2:-}"; shift 2 ;;
    --line) COMMENT_LINE="${2:-}"; shift 2 ;;
    --url) COMMENT_URL="${2:-}"; shift 2 ;;
    --author) COMMENT_AUTHOR="${2:-}"; shift 2 ;;
    --no-resolve) RESOLVE=0; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

BODY=$(cat)
[ -n "$BODY" ] || { echo "Reply body is empty." >&2; exit 2; }
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

TIER=""
ERROR=""
if [ -n "$THREAD_ID" ]; then
  if gh api graphql \
    -f query='mutation($thread: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $thread, body: $body
      }) { comment { id } }
    }' \
    -F thread="$THREAD_ID" -F body="$BODY" >/dev/null 2>"${TMPDIR:-/tmp}/pr-fix-reply-error"; then
    TIER="graphql"
  else
    ERROR=$(<"${TMPDIR:-/tmp}/pr-fix-reply-error")
  fi
fi

if [ -z "$TIER" ] && [ -n "$REPO" ] && [ -n "$PR_NUMBER" ] \
  && [ -n "$FIRST_COMMENT_ID" ] && [ "$FIRST_COMMENT_ID" != "0" ] && [ "$FIRST_COMMENT_ID" != "null" ]; then
  if gh api "repos/$REPO/pulls/$PR_NUMBER/comments/$FIRST_COMMENT_ID/replies" \
    -X POST -f body="$BODY" >/dev/null 2>"${TMPDIR:-/tmp}/pr-fix-reply-error"; then
    TIER="rest"
  else
    ERROR=$(<"${TMPDIR:-/tmp}/pr-fix-reply-error")
  fi
fi

if [ -z "$TIER" ] && [ -n "$REPO" ] && [ -n "$PR_NUMBER" ]; then
  FALLBACK=$(printf 'Re: [%s:%s](%s) (@%s)\n\n%s' \
    "$COMMENT_PATH" "$COMMENT_LINE" "$COMMENT_URL" "$COMMENT_AUTHOR" "$BODY")
  if gh pr comment "$PR_NUMBER" --repo "$REPO" --body "$FALLBACK" \
    >/dev/null 2>"${TMPDIR:-/tmp}/pr-fix-reply-error"; then
    TIER="pr_comment"
  else
    ERROR=$(<"${TMPDIR:-/tmp}/pr-fix-reply-error")
  fi
fi

if [ -z "$TIER" ]; then
  jq -n --arg error "$ERROR" '{reply_tier:null, resolved:false, error:$error}'
  exit 1
fi

RESOLVED=false
RESOLVE_ERROR=""
if [ "$RESOLVE" -eq 1 ] && [ -n "$THREAD_ID" ]; then
  if gh api graphql \
    -f query='mutation($thread: ID!) {
      resolveReviewThread(input: { threadId: $thread }) {
        thread { id isResolved }
      }
    }' \
    -F thread="$THREAD_ID" >/dev/null 2>"${TMPDIR:-/tmp}/pr-fix-resolve-error"; then
    RESOLVED=true
  else
    RESOLVE_ERROR=$(<"${TMPDIR:-/tmp}/pr-fix-resolve-error")
  fi
fi

jq -n --arg tier "$TIER" --argjson resolved "$RESOLVED" \
  --arg resolve_error "$RESOLVE_ERROR" \
  '{reply_tier:$tier, resolved:$resolved, resolve_error:$resolve_error}'
