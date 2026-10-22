#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <PR number> <owner/repo> [bot-pattern]" >&2
  exit 2
fi

PR_NUMBER="$1"
REPO="$2"
BOT_PATTERN="${3:-bot|app|\[bot\]}"
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
  | jq -s --arg bp "$BOT_PATTERN" '
      add as $all
      | [
          $all[]
          | select((.user.login // "") | test($bp; "i"))
          | select((.in_reply_to_id // null) == null)
          | select(.path != null) as $root
          | {
              comment_id: $root.id,
              author: $root.user.login,
              path: $root.path,
              line: ($root.line // $root.original_line),
              html_url: $root.html_url,
              commit_id: $root.commit_id,
              body_summary: (($root.body // "") | gsub("\n+"; " ") | .[0:500]),
              reply_count: ([$all[] | select(.in_reply_to_id == $root.id)] | length)
            }
        ]
      | map(select(.reply_count == 0))
    '
