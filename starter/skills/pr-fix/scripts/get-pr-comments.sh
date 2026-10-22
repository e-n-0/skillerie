#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-a] [-f] [-p] [-r reviewer] [PR number|PR URL|comment URL]" >&2
}

ACTIONABLE=0
FULL=0
POINTER=0
REVIEWER=""
while getopts "afpr:" opt; do
  case "$opt" in
    a) ACTIONABLE=1 ;;
    f) FULL=1 ;;
    p) POINTER=1 ;;
    r) REVIEWER="$OPTARG" ;;
    *) usage; exit 2 ;;
  esac
done
shift $((OPTIND - 1))

command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }

ARG="${1:-}"
COMMENT_ID=""
OWNER=""
REPO_NAME=""
if [[ "$ARG" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)(#discussion_r([0-9]+))?$ ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO_NAME="${BASH_REMATCH[2]}"
  PR_NUMBER="${BASH_REMATCH[3]}"
  COMMENT_ID="${BASH_REMATCH[5]:-}"
elif [[ "$ARG" =~ ^[0-9]+$ ]]; then
  PR_NUMBER="$ARG"
  REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
  OWNER="${REPO%%/*}"
  REPO_NAME="${REPO#*/}"
elif [ -z "$ARG" ]; then
  PR_INFO=$(gh pr view --json number,url)
  PR_NUMBER=$(jq -r '.number' <<<"$PR_INFO")
  REPO_PATH=$(jq -r '.url' <<<"$PR_INFO" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/.*|\1|')
  OWNER="${REPO_PATH%%/*}"
  REPO_NAME="${REPO_PATH#*/}"
else
  usage
  exit 2
fi

QUERY='query($owner:String!, $name:String!, $number:Int!, $endCursor:String) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      reviewThreads(first:100, after:$endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line startLine
          comments(first:50) {
            nodes {
              databaseId author { login } body path line originalLine startLine
              originalStartLine diffHunk outdated createdAt updatedAt commit { oid }
              replyTo { databaseId } url
            }
          }
        }
      }
    }
  }
}'

RAW=$(gh api graphql --paginate \
  -f query="$QUERY" -F owner="$OWNER" -F name="$REPO_NAME" -F number="$PR_NUMBER")
THREADS=$(jq -s '
  [
    .[].data.repository.pullRequest.reviewThreads.nodes[]?
    | {
        thread_id: .id,
        first_comment_id: (.comments.nodes[0].databaseId // 0),
        resolved: .isResolved,
        outdated: .isOutdated,
        path,
        line,
        start_line: .startLine,
        comments: [
          .comments.nodes[]
          | {
              comment_id: .databaseId,
              author: .author.login,
              body,
              path,
              line,
              original_line: .originalLine,
              start_line: .startLine,
              original_start_line: .originalStartLine,
              diff_hunk: .diffHunk,
              outdated,
              created_at: .createdAt,
              updated_at: .updatedAt,
              commit_id: .commit.oid,
              in_reply_to_id: .replyTo.databaseId,
              html_url: .url
            }
        ]
      }
  ]
' <<<"$RAW")

if [ -n "$COMMENT_ID" ]; then
  THREADS=$(jq --arg id "$COMMENT_ID" '
    [ .[] | select(any(.comments[]; (.comment_id | tostring) == $id))
      | (.comments[] | select((.comment_id | tostring) == $id)) as $comment
      | .path = (.path // $comment.path)
      | .line = (.line // $comment.line // $comment.original_line)
      | .start_line = (.start_line // $comment.start_line // $comment.original_start_line)
    ]
  ' <<<"$THREADS")
  if [ "$(jq 'length' <<<"$THREADS")" -eq 0 ]; then
    THREADS=$(gh api "repos/$OWNER/$REPO_NAME/pulls/comments/$COMMENT_ID" | jq '
      [{
        thread_id: null,
        first_comment_id: .id,
        resolved: false,
        outdated: (.outdated // false),
        path,
        line: (.line // .original_line),
        start_line: (.start_line // .original_start_line),
        comments: [{
          comment_id: .id,
          author: .user.login,
          body,
          path,
          line: (.line // .original_line),
          original_line,
          start_line: (.start_line // .original_start_line),
          original_start_line,
          diff_hunk,
          outdated: (.outdated // false),
          created_at,
          updated_at,
          commit_id,
          in_reply_to_id,
          html_url
        }]
      }]
    ')
  fi
fi

if [ -n "$REVIEWER" ]; then
  THREADS=$(jq --arg reviewer "$REVIEWER" '[.[] | select((.comments[0].author // "") == $reviewer)]' <<<"$THREADS")
fi
THREADS=$(jq 'sort_by(.comments[0].created_at) | reverse' <<<"$THREADS")
if [ "$ACTIONABLE" -eq 1 ] && [ -z "$COMMENT_ID" ]; then
  THREADS=$(jq '[.[] | select(.resolved == false and .outdated == false)]' <<<"$THREADS")
fi
if [ "$FULL" -eq 0 ]; then
  THREADS=$(jq '[.[] | .comments = [.comments[] | del(.diff_hunk)]]' <<<"$THREADS")
fi

BYTES=$(printf '%s' "$THREADS" | wc -c | tr -d ' ')
if [ "$BYTES" -gt 25000 ]; then
  OUT=$(mktemp "${TMPDIR:-/tmp}/pr-comments.XXXXXX")
  printf '%s\n' "$THREADS" >"$OUT"
  if [ "$POINTER" -eq 1 ]; then
    jq -n --arg output_file "$OUT" --argjson bytes "$BYTES" \
      --argjson threads "$(jq 'length' <<<"$THREADS")" \
      '{output_file:$output_file, bytes:$bytes, thread_count:$threads}'
    exit 0
  fi
  echo "Large result saved to $OUT" >&2
fi
printf '%s\n' "$THREADS"
