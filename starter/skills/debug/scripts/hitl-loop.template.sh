#!/usr/bin/env bash
# Human-guided reproduction helper.
# Replace the example steps with the scenario under investigation.
#
# Usage:
#   bash hitl-loop.template.sh
#
# step "<instruction>" displays a step and waits for Enter.
# capture VAR "<question>" records a short response for the agent to read.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Press Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open https://example.com and navigate to the affected feature."

capture FAILED "Perform the action. Did the reported failure occur? (y/n)"

capture OBSERVATION "Record the exact visible result (or 'none'):"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'FAILED=%s\n' "$FAILED"
printf 'OBSERVATION=%s\n' "$OBSERVATION"
