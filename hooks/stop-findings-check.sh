#!/bin/bash
set -euo pipefail
# Stop hook: check for open findings and surface them to Claude.
# MUST NOT trigger new reviews (prevents infinite loops).

COUNT=$(node dist/cli.js check-unresolved --count 2>/dev/null || echo "0")

if [ -n "$COUNT" ] && [ "$COUNT" -gt 0 ] 2>/dev/null; then
  echo "{\"systemMessage\":\"Codex found $COUNT unresolved finding(s). Run bridge_get_findings to review them before proceeding.\"}"
fi
