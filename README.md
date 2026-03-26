# claude-peer-pressure

An MCP (Model Context Protocol) server that triggers Codex peer reviews on Claude Code's changes. Findings are stored in SQLite and surfaced via MCP tools. A pre-commit hook blocks commits with unresolved critical findings.

## What It Does

When you're working in Claude Code:
1. After each code change (Edit, Write), a debounced review trigger fires (30s window)
2. Codex runs `codex exec review --uncommitted` to review uncommitted changes
3. Findings are parsed and stored in SQLite with status, severity, and location
4. Claude can call MCP tools to fetch, review, and resolve findings
5. Git pre-commit hook blocks commits if critical findings remain unresolved

## Quick Start

### Build
```bash
npm install
npm run build
```

### Run MCP Server
```bash
npm start
# Listens on stdio — configure in `.claude/settings.local.json`
```

### Install Hooks
```bash
npm run hook:install
# Sets up git pre-commit hook at .git/hooks/pre-commit
```

### Run Tests
```bash
npm test
```

### CLI (for hooks)
```bash
node dist/cli.js check-unresolved --count
node dist/cli.js check-unresolved --block
node dist/cli.js status
```

## Architecture

```
Claude Code
    ↓ (PostToolUse hook)
post-tool-use-review-trigger.sh (debounced)
    ↓ (30s window)
bridge_request_review (MCP tool)
    ↓
codex-runner.ts (spawn Codex CLI)
    ↓
Codex LLM (review uncommitted changes)
    ↓ (JSONL output)
codex-runner.ts (parse findings)
    ↓
database.ts (SQLite storage)
    ↓ (shared DB)
MCP tools (bridge_get_findings, bridge_resolve_finding, bridge_status)
    ↓
Claude Claude Code (review findings)
    ↓ (git commit)
pre-commit.sh hook (block on critical)
    ↓
stop-findings-check.sh (surface remaining findings to Claude)
```

## MCP Tools

### `bridge_request_review`
Trigger a Codex review on uncommitted changes.

**Params:**
- `trigger` (optional, default "manual"): "hook" | "manual" | "pre-commit"

**Returns:** `{ review_id, status, message }`

**Example:**
```
Input: { trigger: "manual" }
Output: {
  "review_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "started",
  "message": "Review completed with 2 finding(s)"
}
```

### `bridge_get_findings`
List code review findings from the database.

**Params:**
- `status` (optional, default "open"): "open" | "resolved" | "rejected" | "all"
- `review_id` (optional): Filter by review UUID

**Returns:** `{ findings: Finding[], total, has_critical }`

**Finding object:**
```ts
{
  id: number,
  review_id: string,
  severity: "critical" | "warning" | "info",
  message: string,
  file_path: string | null,
  line_range: string | null,
  status: "open" | "resolved" | "rejected",
  resolution: string | null,
  created_at: string,
  resolved_at: string | null
}
```

### `bridge_resolve_finding`
Mark a finding as resolved or rejected.

**Params:**
- `finding_id` (required): The finding ID
- `action` (required): "resolved" | "rejected"
- `resolution` (optional): Reason for resolution

**Returns:** `{ success: boolean, finding_id }`

### `bridge_status`
Check bridge status: running reviews, stats, Codex availability.

**Params:** None

**Returns:**
```ts
{
  review_in_progress: boolean,
  total_reviews: number,
  total_findings: number,
  open_findings: number,
  critical_open: number,
  last_review: { id, created_at, finding_count } | null
}
```

## CLI

### `check-unresolved`
```bash
node dist/cli.js check-unresolved [--count|--block|--severity=SEVERITY]
```
- `--count`: Print count only
- `--block`: Exit 1 if critical findings exist (used by pre-commit hook)
- `--severity=critical|warning|info`: Filter by severity

**Typical pre-commit usage:**
```bash
node dist/cli.js check-unresolved --block
# Exits 0 if no critical findings, exits 1 otherwise
```

### `status`
```bash
node dist/cli.js status
```
Print overall bridge stats: review count, finding counts, last review.

## Database

SQLite at `.a2a/bridge.db` (WAL mode).

### Schema

**reviews table**
- `id` (TEXT PRIMARY KEY): UUID
- `diff_hash` (TEXT): SHA-256 hash of staged + unstaged + untracked diffs
- `trigger` (TEXT): "hook" | "manual" | "pre-commit"
- `codex_output` (TEXT): Raw JSONL from Codex (nullable)
- `finding_count` (INTEGER): Count of parsed findings
- `created_at` (TEXT): ISO timestamp

**findings table**
- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `review_id` (TEXT FK): Reference to reviews(id)
- `severity` (TEXT): "critical" | "warning" | "info"
- `message` (TEXT): Finding description
- `file_path` (TEXT): Source file (nullable)
- `line_range` (TEXT): Line number or range, e.g. "3" or "10-15" (nullable)
- `status` (TEXT): "open" | "resolved" | "rejected"
- `resolution` (TEXT): Why it was resolved/rejected (nullable)
- `created_at` (TEXT): When finding was discovered
- `resolved_at` (TEXT): When finding was resolved (nullable)

## Hook Integration

### `.claude/settings.local.json`
Configure Claude Code hooks to integrate this bridge:

```json
{
  "hooks": {
    "postToolUse": [
      "bash hooks/post-tool-use-review-trigger.sh"
    ],
    "stop": [
      "bash hooks/stop-findings-check.sh"
    ]
  }
}
```

### Debounce
`post-tool-use-review-trigger.sh` debounces review requests: only fires if >30s since last request. Prevents review spam during rapid editing.

### Pre-commit Hook
`pre-commit.sh` blocks commits with critical unresolved findings. Warns about non-critical findings. Can bypass with `git commit --no-verify`.

### Stop Hook
`stop-findings-check.sh` surfaces unresolved finding count to Claude on session stop.

## Design Decisions

- **Single-queue execution**: One Codex process at a time. Newer requests supersede queued ones.
- **Diff deduplication**: SHA-256 hash of staged + unstaged + untracked changes. Prevents redundant reviews.
- **Transaction-based insert**: `insertReviewIfNew` uses transactions to prevent race conditions.
- **Lenient JSONL parser**: Extracts findings from Codex output, ignores malformed lines gracefully.
- **Database singleton**: Single instance per process with path-mismatch detection.

## Dependencies

- `@modelcontextprotocol/sdk` ^1.28.0 — MCP server framework
- `better-sqlite3` ^12.8.0 — Embedded SQLite
- `zod` (via MCP SDK) — Parameter validation

## Development

### File Structure
```
src/
  mcp-server.ts       (193 lines)  — MCP server + 4 tools
  codex-runner.ts     (279 lines)  — Codex spawning + JSONL parsing
  database.ts         (239 lines)  — SQLite CRUD + schema
  cli.ts              (83 lines)   — Hook CLI
  diff-hasher.ts      (48 lines)   — Diff → SHA-256
hooks/
  pre-commit.sh       (27 lines)   — Git hook (blocks on critical)
  post-tool-use-review-trigger.sh  (18 lines) — Debounce trigger
  stop-findings-check.sh           (10 lines) — Findings count on stop
test/
  integration-test.ts (198 lines)  — Integrated tests
```

### Code Standards
- ESM modules, strict TypeScript (`strict: true`)
- Kebab-case file names, PascalCase exports
- No test framework — custom test runner with node:assert
- SQLite singleton pattern
- Error handling via try-catch + proper exit codes

### Verify Build
```bash
npm run build
# Compiles to dist/
```

## Roadmap

### v0.1.0 (Current)
Initial implementation with Codex review integration, SQLite persistence, and git hooks.

### Future
- Additional review providers (Claude 3.5, local models)
- Configurable review prompts per severity
- Finding categories (performance, security, style, etc.)
- Web dashboard for finding trends
- Batch resolution workflows
- Integration with GitHub/GitLab for PR comments

## License

MIT
