#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <PR number> [poll-interval] [max-polls]" >&2
  exit 2
fi

PR_NUMBER="$1"
POLL_INTERVAL="${2:-30}"
MAX_POLLS="${3:-40}"
GATED_PATTERN="manual.approval|review.required|code.owner|approval.gate"
LAST_FILTERED="[]"
LAST_COUNTS=""
STATUS_FILE=""

if ! [[ "$POLL_INTERVAL" =~ ^[0-9]+$ && "$MAX_POLLS" =~ ^[0-9]+$ ]]; then
  echo "Poll interval and max polls must be non-negative integers." >&2
  exit 2
fi
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required." >&2; exit 1; }

for ((i = 1; i <= MAX_POLLS; i++)); do
  RAW=$(gh pr checks "$PR_NUMBER" --json name,state,bucket,link 2>&1) || true
  if ! jq empty <<<"$RAW" 2>/dev/null; then
    echo "ERROR: gh pr checks returned invalid JSON"
    echo "$RAW"
    exit 1
  fi

  FILTERED=$(jq --arg pattern "$GATED_PATTERN" \
    '[.[] | select((.name | ascii_downcase | test($pattern)) | not)]' <<<"$RAW")
  FAILED=$(jq '[.[] | select(.state == "FAILURE")] | length' <<<"$FILTERED")
  PENDING=$(jq '[.[] | select(.state == "PENDING" or .state == "IN_PROGRESS" or .state == "QUEUED")] | length' <<<"$FILTERED")
  TOTAL=$(jq 'length' <<<"$FILTERED")
  PASSED=$((TOTAL - FAILED - PENDING))
  COUNTS="passed=$PASSED pending=$PENDING failed=$FAILED total=$TOTAL"
  LAST_FILTERED="$FILTERED"

  if [ "$COUNTS" != "$LAST_COUNTS" ]; then
    echo "poll $i/$MAX_POLLS: $COUNTS"
    LAST_COUNTS="$COUNTS"
  fi
  if [ "$FAILED" -gt 0 ]; then
    STATUS_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-fix-ci.XXXXXX")
    printf '%s\n' "$LAST_FILTERED" >"$STATUS_FILE"
    echo
    echo "FAILURES_DETECTED"
    echo "STATUS_FILE: $STATUS_FILE"
    jq -r '.[] | select(.state == "FAILURE") | "  \(.name) — \(.link)"' <<<"$FILTERED"
    exit 0
  fi
  if [ "$PENDING" -eq 0 ] && [ "$TOTAL" -gt 0 ]; then
    MERGEABLE=$(gh pr view "$PR_NUMBER" --json mergeable --jq '.mergeable' 2>/dev/null || echo "UNKNOWN")
    if [ "$MERGEABLE" = "CONFLICTING" ]; then
      echo
      echo "CONFLICTS_DETECTED"
      echo "passed=$PASSED total=$TOTAL mergeable=$MERGEABLE"
      exit 0
    fi
    echo
    echo "ALL_PASSING"
    echo "passed=$PASSED total=$TOTAL mergeable=$MERGEABLE"
    exit 0
  fi
  if [ "$i" -lt "$MAX_POLLS" ]; then
    sleep "$POLL_INTERVAL"
  fi
done

STATUS_FILE=$(mktemp "${TMPDIR:-/tmp}/pr-fix-ci.XXXXXX")
printf '%s\n' "$LAST_FILTERED" >"$STATUS_FILE"
echo
echo "TIMEOUT"
echo "Polled $MAX_POLLS times at ${POLL_INTERVAL}s intervals"
echo "LAST_SUMMARY: ${LAST_COUNTS:-no checks returned}"
echo "STATUS_FILE: $STATUS_FILE"
echo "PENDING_CHECKS:"
jq '[.[] | select(.state == "PENDING" or .state == "IN_PROGRESS" or .state == "QUEUED")]' <<<"$LAST_FILTERED"
exit 1
