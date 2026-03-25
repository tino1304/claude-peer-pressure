#!/bin/bash
# Mock Codex CLI for offline testing.
# Mimics `codex exec review --uncommitted --json --ephemeral -o <outfile> <prompt>`
#
# Behavior controlled by MOCK_CODEX_MODE env var:
#   findings  (default) — returns findings JSONL
#   clean     — returns "no issues" JSONL
#   error     — exits with error code
#   timeout   — hangs until killed
#   auth      — simulates auth error

MODE="${MOCK_CODEX_MODE:-findings}"

# Parse -o flag for output file
OUTFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) OUTFILE="$2"; shift 2 ;;
    *) shift ;;
  esac
done

case "$MODE" in
  findings)
    cat <<'JSONL'
{"type":"message","role":"assistant","content":[{"type":"text","text":"[CRITICAL] sample-buggy-code.js:3 — SQL injection via string concatenation\n[CRITICAL] sample-buggy-code.js:4 — Arbitrary code execution via eval()\n[WARNING] sample-buggy-code.js:2 — Missing input validation"}]}
JSONL
    if [ -n "$OUTFILE" ]; then
      echo "Review complete. Found 3 issues." > "$OUTFILE"
    fi
    ;;
  clean)
    cat <<'JSONL'
{"type":"message","role":"assistant","content":[{"type":"text","text":"[INFO] No issues found."}]}
JSONL
    if [ -n "$OUTFILE" ]; then
      echo "Review complete. No issues found." > "$OUTFILE"
    fi
    ;;
  error)
    echo "Error: Codex internal failure" >&2
    exit 1
    ;;
  timeout)
    sleep 300
    ;;
  auth)
    echo "Error: API key invalid or expired. Please run codex auth login." >&2
    exit 1
    ;;
esac
