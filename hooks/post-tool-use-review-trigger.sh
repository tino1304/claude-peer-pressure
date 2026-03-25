#!/bin/bash
# Debounced review trigger for Claude PostToolUse hook.
# Skips if a review was requested within the last 30 seconds.

LAST_FILE=".a2a/tmp/last-review-request"
NOW=$(date +%s)

if [ -f "$LAST_FILE" ]; then
  LAST=$(cat "$LAST_FILE")
  DIFF=$((NOW - LAST))
  [ "$DIFF" -lt 30 ] && exit 0
fi

mkdir -p .a2a/tmp
echo "$NOW" > "$LAST_FILE"

# Signal bridge — lightweight touch-file approach
touch .a2a/tmp/review-requested
