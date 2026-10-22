#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [-p] [-r reviewer] [PR number|PR URL]" >&2
}

POINTER=0
REVIEWER=""
while getopts "pr:" opt; do
  case "$opt" in
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
if [[ "$ARG" =~ ^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
  OWNER="${BASH_REMATCH[1]}"
  REPO="${BASH_REMATCH[2]}"
  NUMBER="${BASH_REMATCH[3]}"
elif [[ "$ARG" =~ ^[0-9]+$ ]]; then
  NUMBER="$ARG"
  REPO_PATH=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
  OWNER="${REPO_PATH%%/*}"
  REPO="${REPO_PATH#*/}"
elif [ -z "$ARG" ]; then
  PR_INFO=$(gh pr view --json number,url)
  NUMBER=$(jq -r '.number' <<<"$PR_INFO")
  REPO_PATH=$(jq -r '.url' <<<"$PR_INFO" | sed -E 's|https://github.com/([^/]+/[^/]+)/pull/.*|\1|')
  OWNER="${REPO_PATH%%/*}"
  REPO="${REPO_PATH#*/}"
else
  usage
  exit 2
fi

REVIEWS=$(gh api "repos/$OWNER/$REPO/pulls/$NUMBER/reviews" --paginate \
  | jq -s --arg reviewer "$REVIEWER" '
    add
    | [
        .[]
        | select((.body // "") | length > 0)
        | select($reviewer == "" or .user.login == $reviewer)
        | {
            review_id: .id,
            author: .user.login,
            state,
            body,
            submitted_at,
            html_url,
            commit_id
          }
      ]
    | sort_by(.submitted_at, .review_id)
    | reverse
  ')

BYTES=$(printf '%s' "$REVIEWS" | wc -c | tr -d ' ')
if [ "$BYTES" -gt 25600 ]; then
  OUT=$(mktemp "${TMPDIR:-/tmp}/pr-review-summaries.XXXXXX")
  printf '%s\n' "$REVIEWS" >"$OUT"
  if [ "$POINTER" -eq 1 ]; then
    jq -n --arg output_file "$OUT" --argjson bytes "$BYTES" \
      '{output_file:$output_file, bytes:$bytes}'
    exit 0
  fi
  echo "Large result saved to $OUT" >&2
fi
printf '%s\n' "$REVIEWS"
