# claude-peer-pressure: Project Overview & PDR

## Project Purpose

**claude-peer-pressure** enables AI-assisted code peer review for Claude Code development. It bridges Claude Code's code edits with OpenAI's Codex LLM for independent review, storing findings in SQLite and blocking commits on unresolved critical issues.

**Target Users:** Claude Code users who want Codex-powered peer review during development sessions.

## Problem Statement

Developers using Claude Code lack automated peer review feedback on their changes. Manual Codex review requires context-switching and explicit invocation. This project automates review triggering, persistence, and blocking to integrate peer review seamlessly into the development workflow.

## Goals

1. **Automatic Trigger** — Review launches automatically on code edits via Claude Code hooks
2. **Persistent Storage** — Findings stored in SQLite for audit trail and blocking
3. **Interactive Triage** — Claude can review, resolve, or reject findings via MCP tools
4. **Commit Blocking** — Git pre-commit hook prevents merging code with unresolved critical findings
5. **Low Overhead** — Debounced triggers and deduplication prevent review spam

## Non-Goals

- Web dashboard (use CLI or MCP tools)
- Multiple review providers in v0.1.0 (Codex-only)
- GPU-accelerated or self-hosted models
- IDE plugins beyond Claude Code

## Architecture Overview

1. **Hook Triggers** — Claude PostToolUse (debounced 30s) → `post-tool-use-review-trigger.sh`
2. **MCP Server** — Exposes 4 tools for requesting and managing reviews
3. **Codex Runner** — Spawns Codex CLI, parses JSONL findings
4. **SQLite DB** — Persists reviews and findings with status tracking
5. **Git Hook** — Pre-commit blocks on critical findings, warns on non-critical

## Functional Requirements

### F1: Review Triggering
- PostToolUse hook debounces (30s window) and signals review request
- `bridge_request_review` MCP tool manually triggers review or queues if one running
- Deduplicates by diff hash (SHA-256 of staged + unstaged + untracked files)

### F2: Codex Integration
- Spawns `codex exec review --uncommitted --json --ephemeral`
- Parses JSONL output for `[SEVERITY] file:line — message` patterns
- Timeout: 120s
- Graceful handling of auth errors and missing Codex CLI

### F3: Finding Persistence
- Stores reviews (id, diff_hash, trigger, codex_output, finding_count)
- Stores findings (severity, message, file_path, line_range, status)
- Supports status transitions: open → resolved/rejected

### F4: Finding Management
- `bridge_get_findings` MCP tool: query by status or review_id
- `bridge_resolve_finding` MCP tool: mark finding resolved/rejected with optional reason
- `bridge_status` MCP tool: aggregate stats

### F5: Git Integration
- Pre-commit hook blocks on unresolved critical findings
- Pre-commit hook warns on unresolved non-critical findings
- Stop hook surfaces finding count to Claude on session end

## Non-Functional Requirements

### NFR1: Performance
- Review spawn to result: <120s
- Database query (findings): <100ms
- Dedup check via diff hash: <10ms

### NFR2: Reliability
- Single-queue execution prevents race conditions (transaction-based dedup)
- Database singleton detects path mismatches
- Lenient JSONL parser ignores malformed lines
- Graceful shutdown of Codex process on timeout

### NFR3: Data Integrity
- SQLite WAL mode for concurrent access
- Foreign key constraints enabled
- Transaction wrapping for critical operations
- findings.status default: 'open'

### NFR4: Maintainability
- Strict TypeScript (`strict: true`)
- ESM modules for clarity
- Kebab-case filenames
- No external test framework (node:assert)

## Technical Constraints

1. **Node.js >=20.0.0** — Uses modern ESM, node:crypto, child_process
2. **Codex CLI Required** — `codex` must be installed and in PATH
3. **Git Repo** — Assumes .git directory exists
4. **SQLite 3** — Via better-sqlite3 (native module, needs compilation)

## Acceptance Criteria

- [ ] MCP server starts without errors and listens on stdio
- [ ] All 4 MCP tools callable and return valid JSON
- [ ] Codex review completes and findings stored in DB
- [ ] Dedup prevents redundant reviews for same diff
- [ ] Pre-commit hook blocks on critical, allows with --no-verify
- [ ] Integration tests pass (database, parser, CLI, dedup)
- [ ] README and docs accurate and complete

## Success Metrics

1. **Availability** — MCP server uptime 99%+ across sessions
2. **Coverage** — Review finds >80% of injected critical issues (test suite)
3. **Latency** — Review request → completion <120s (99th percentile)
4. **UX** — Dedup prevents redundant reviews (same diff seen only once)
5. **Safety** — No data loss on process termination (WAL + transactions)

## Version History

### v0.1.0 (2026-03-26)
**Initial Implementation**
- Codex peer review via MCP
- SQLite persistence
- Git hook integration
- 4 MCP tools (request, get, resolve, status)
- Debounced triggering
- Diff deduplication

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.28.0 | MCP server framework |
| `better-sqlite3` | ^12.8.0 | SQLite driver |
| `zod` | (via MCP SDK) | Parameter validation |

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|-----------|
| Codex timeout on large diffs | Medium | Review stalls user | 120s timeout, user can --no-verify |
| Race condition on insert | Low | Duplicate review IDs | Transaction-based dedup |
| Database corruption | Low | Data loss | WAL mode + transaction wrapping |
| Path mismatch on re-init | Low | DB inconsistency | Singleton with path detection |
| Malformed JSONL from Codex | Medium | Findings lost | Lenient parser, store raw output |
| Codex not installed | Medium | Review fails gracefully | Error handling + user message |

## Known Limitations

1. **Single Codex per session** — Doesn't support parallel reviews from multiple Claude instances
2. **Lenient parsing** — Some finding context lost if Codex output deviates from expected format
3. **Manual blocking** — User can bypass pre-commit with --no-verify (by design)
4. **No retry logic** — Failed Codex calls not automatically retried
5. **Limited finding context** — No context lines, only file:line and message

## Future Enhancements

- **Provider abstraction** — Support Claude 3.5, local models, Anthropic API
- **Configurable prompts** — Per-severity review prompts
- **Finding categories** — Tag findings by type (performance, security, style)
- **Dashboard** — Web UI for finding trends and resolution metrics
- **Batch resolution** — Bulk mark/dismiss similar findings
- **PR integration** — Post findings as GitHub/GitLab PR comments
- **Finding dedupe** — Detect duplicate findings across reviews
- **Custom severity** — User-defined severity levels

## Approval Checklist

- [x] Architecture aligns with constraints
- [x] Requirements cover all features
- [x] Success criteria measurable and testable
- [x] Dependencies reviewed and compatible
- [x] Risks identified and mitigations documented
- [x] Roadmap realistic for team size and scope
