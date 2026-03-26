# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**claude-peer-pressure** — an MCP server that triggers Codex CLI to peer-review Claude's code changes, stores findings in SQLite, and blocks commits on unresolved critical findings.

## Commands

```bash
npm run build          # TypeScript compile (tsc) → dist/
npm run test           # Integration tests via tsx (npx tsx test/integration-test.ts)
npm run start          # Run MCP server (stdio transport)
npm run cli            # Run CLI directly (node dist/cli.js)
npm run hook:install   # Copy pre-commit hook to .git/hooks/
```

CLI usage:
```bash
node dist/cli.js check-unresolved --count          # Print open finding count
node dist/cli.js check-unresolved --block           # Exit 1 if critical findings
node dist/cli.js check-unresolved --severity=critical
node dist/cli.js status                             # Aggregate stats
```

## Architecture

```
Claude Code hooks (.claude/settings.local.json)
  ├─ PostToolUse (Edit/Write/MultiEdit) → hooks/post-tool-use-review-trigger.sh (30s debounce)
  └─ Stop → hooks/stop-findings-check.sh (surfaces unresolved count)

MCP Server (src/mcp-server.ts) — stdio transport, 4 tools:
  ├─ bridge_request_review  → codex-runner → spawns `codex exec review --uncommitted --json`
  ├─ bridge_get_findings    → database query with status/review_id filters
  ├─ bridge_resolve_finding → mark finding resolved/rejected
  └─ bridge_status          → aggregate stats + review-in-progress flag

Data flow:
  git diff → diff-hasher (SHA-256) → dedup check → Codex CLI spawn → JSONL parse → SQLite
```

**Key design decisions:**
- **Diff-hash dedup**: Same uncommitted diff won't trigger duplicate reviews. Empty/failed git commands produce random hash to prevent false cache hits.
- **Single-queue execution**: Only one Codex process runs at a time. Subsequent requests queue; earlier queued callers get superseded.
- **Transaction-based insert**: `insertReviewIfNew` uses SQLite transaction to prevent race conditions on concurrent review requests.
- **Pre-commit gate**: Hook blocks commit if any critical findings are open; non-critical findings show as warnings.

## Database

SQLite at `.a2a/bridge.db` (WAL mode, foreign keys ON). Two tables:
- `reviews`: id (UUID), diff_hash, trigger, codex_output, finding_count
- `findings`: id (autoincrement), review_id (FK), severity (critical/warning/info), status (open/resolved/rejected), file_path, line_range

Database is a singleton — calling `getDb()` with a different path after init throws.

## Testing

Tests are a single integration file (`test/integration-test.ts`) using `node:assert`. No test framework — just a custom `test()` runner. Tests use a temp DB at `test/.tmp-test/test.db` and clean up after. Build first (`npm run build`) before running tests since the test imports compiled source.

## Codex Output Format

The parser (`parseFindings`) expects lines matching: `[SEVERITY] file:line — message`. It first tries to extract assistant content from Codex JSONL events, then falls back to raw text parsing. `[INFO] No issues found.` is treated as a clean review (zero findings).
