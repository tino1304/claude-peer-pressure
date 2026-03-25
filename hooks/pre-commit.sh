#!/bin/bash
set -euo pipefail
# Git pre-commit hook — block on critical unresolved findings.
# Install: npm run hook:install

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_CLI="node ${SCRIPT_DIR}/../dist/cli.js"

# Check for critical findings (exits 1 if any exist)
RESULT=$($BRIDGE_CLI check-unresolved --block 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "BLOCKED: Codex found critical unresolved findings:"
  echo "$RESULT"
  echo ""
  echo "Run 'bridge_get_findings' in Claude to review, or 'git commit --no-verify' to bypass."
  exit 1
fi

# Warn about non-critical open findings
WARNINGS=$($BRIDGE_CLI check-unresolved --count 2>/dev/null)
if [ -n "$WARNINGS" ] && [ "$WARNINGS" -gt 0 ] 2>/dev/null; then
  echo "Note: $WARNINGS non-critical Codex finding(s) still open."
fi

exit 0
