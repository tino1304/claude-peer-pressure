# claude-peer-pressure: Codebase Summary

## Module Overview

| File | LOC | Responsibility |
|------|-----|-----------------|
| `src/mcp-server.ts` | 193 | MCP server definition, 4 tools, stdio transport |
| `src/codex-runner.ts` | 279 | Codex CLI spawning, JSONL parsing, single-queue execution |
| `src/database.ts` | 239 | SQLite schema, CRUD operations, transaction-based dedup |
| `src/cli.ts` | 83 | Hook CLI for querying findings and blocking commits |
| `src/diff-hasher.ts` | 48 | Diff collection and SHA-256 hashing for dedup |
| `test/integration-test.ts` | 198 | Database, parser, CLI, and dedup tests |
| `hooks/pre-commit.sh` | 27 | Git hook: blocks on critical findings |
| `hooks/post-tool-use-review-trigger.sh` | 18 | Claude hook: debounced review trigger |
| `hooks/stop-findings-check.sh` | 10 | Claude hook: surfaces findings on stop |

## Data Flow

```
User edits code in Claude Code
     ↓
PostToolUse hook fires (Edit/Write)
     ↓
post-tool-use-review-trigger.sh
  (debounce 30s, check if already requested)
     ↓
bridge_request_review (MCP tool)
     ↓
codex-runner.ts::requestReview()
  (queue or execute)
     ↓
diff-hasher.ts::computeDiffHash()
  (SHA-256 of staged + unstaged + untracked)
     ↓
database.ts::insertReviewIfNew()
  (transactional dedup, return if exists)
     ↓
codex-runner.ts::spawnCodex()
  (spawn: codex exec review --uncommitted --json)
     ↓
parse JSONL + regex match [SEVERITY] file:line — message
     ↓
database.ts::insertFinding() (per finding)
     ↓
database.ts::updateReviewOutput()
     ↓
returnPromise to MCP tool
     ↓
Claude reads findings via bridge_get_findings
     ↓
Claude resolves via bridge_resolve_finding
     ↓
User commits: pre-commit.sh blocks if critical findings open
     ↓
stop-findings-check.sh surfaces count to Claude
```

## Module Details

### `src/mcp-server.ts`

**Exports:**
- Server startup (no exported functions; runs at module load)

**Key Functionality:**
- McpServer instance with name "claude-peer-pressure"
- 4 tool definitions:
  1. `bridge_request_review(trigger?)` → Review result
  2. `bridge_get_findings(status?, review_id?)` → Finding list
  3. `bridge_resolve_finding(finding_id, action, resolution?)` → Success response
  4. `bridge_status()` → Aggregate stats
- Graceful shutdown handlers (SIGTERM, SIGINT)
- Stdio transport for Claude Code integration

**Dependencies:** codex-runner, database

### `src/codex-runner.ts`

**Exports:**
```ts
export interface ReviewResult {
  reviewId: string;
  cached: boolean;
  findings: ParsedFinding[];
  error?: string;
}

export function isReviewRunning(): boolean
export function requestReview(trigger): Promise<ReviewResult>
export function parseFindings(output: string): ParsedFinding[]
```

**Key Functionality:**
1. **Single-queue execution** — `running` flag + `queued` state
   - Only one Codex process at a time
   - Newer requests supersede queued ones
2. **Review dedup** — checks if review already exists for diff_hash
3. **Codex spawning** — 120s timeout, handles auth errors
4. **JSONL parsing** — lenient regex for `[SEVERITY] file:line — message`
   - Extracts assistant content from JSON events
   - Skips "no issues found" placeholder
5. **Error handling** — graceful on Codex not found, auth errors, timeout

**Dependencies:** database, diff-hasher

### `src/database.ts`

**Exports:**
```ts
export interface Review { id, diff_hash, trigger, codex_output, finding_count, created_at }
export interface Finding { id, review_id, severity, message, file_path, line_range, status, resolution, created_at, resolved_at }

export function getDb(dbPath?): Database
export function closeDb(): void
export function insertReviewIfNew(diffHash, trigger): { reviewId, existing }
export function updateReviewOutput(reviewId, output, count): void
export function insertFinding(reviewId, severity, message, filePath?, lineRange?): number
export function getFindings(query): Finding[]
export function getOpenFindings(severity?): Finding[]
export function resolveFinding(findingId, status, resolution?): void
export function getBridgeStats(): BridgeStats
export function findReviewByDiffHash(diffHash): Review | undefined
```

**Key Functionality:**
1. **Schema** — 2 tables (reviews, findings) with FK + indexes
2. **Singleton pattern** — `getDb()` returns same instance, detects path mismatch
3. **Transaction-based dedup** — `insertReviewIfNew()` atomically checks + inserts
4. **WAL mode** — SQLite journal_mode for concurrent access
5. **Foreign keys enabled** — referential integrity
6. **Timestamped records** — created_at, resolved_at tracking

**Key Queries:**
- `getOpenFindings()` — filter by status = 'open'
- `getBridgeStats()` — count queries across both tables
- `resolveFinding()` — update status + timestamp, throw if not found

### `src/cli.ts`

**Exports:** None (executable)

**Commands:**
1. `check-unresolved [--count|--block|--severity=X]`
   - `--count`: Print open finding count
   - `--block`: Exit 1 if critical findings exist (pre-commit)
   - `--severity=critical|warning|info`: Filter
2. `status` — Print review count, finding counts, last review

**Key Functionality:**
- Severity validation before querying
- Formatted output for human readability
- Proper exit codes for hook scripts
- Graceful close on exit

### `src/diff-hasher.ts`

**Exports:**
```ts
export function computeDiffHash(): string
```

**Key Functionality:**
1. Collects 3 git diffs:
   - Staged: `git diff --cached`
   - Unstaged: `git diff`
   - Untracked: `git ls-files --others --exclude-standard`
2. Concatenates with newlines
3. Returns SHA-256 hash of combined string
4. **H3 fix** — Returns random hash if all diffs empty (prevents false cache hits)
5. Max buffer: 10MB per git command

**Use:** Dedup prevention in `codex-runner.ts::requestReview()`

## Database Schema

```sql
CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  diff_hash TEXT NOT NULL,
  trigger TEXT NOT NULL,
  codex_output TEXT,
  finding_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_reviews_diff_hash ON reviews(diff_hash);

CREATE TABLE findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  file_path TEXT,
  line_range TEXT,
  status TEXT DEFAULT 'open',
  resolution TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_review ON findings(review_id);
```

## Hook Integration

### `post-tool-use-review-trigger.sh`
- Fired by Claude PostToolUse (Edit/Write)
- Checks `.a2a/tmp/last-review-request` timestamp
- Skips if <30s since last request
- Writes timestamp to file
- Creates `.a2a/tmp/review-requested` touch file as signal

### `pre-commit.sh`
- Git hook at `.git/hooks/pre-commit`
- Calls `node dist/cli.js check-unresolved --block`
- Blocks commit (exit 1) if critical findings exist
- Warns on non-critical findings
- Allows bypass with `git commit --no-verify`

### `stop-findings-check.sh`
- Claude Stop hook
- Calls `node dist/cli.js check-unresolved --count`
- Outputs JSON system message if findings exist
- Does NOT trigger new reviews (prevents loops)

## Key Design Patterns

### 1. Single-Queue Execution
```ts
let running = false;
let queued = null;

export function requestReview(trigger) {
  return new Promise((resolve) => {
    if (running) {
      // Supersede previous queued caller
      if (queued) queued.resolve({ error: "Superseded" });
      queued = { trigger, resolve };
      return;
    }
    void executeReview(trigger, resolve);
  });
}
```
Ensures only one Codex process runs at a time, newer requests take priority.

### 2. Transaction-Based Dedup
```ts
export function insertReviewIfNew(diffHash, trigger) {
  const result = d.transaction(() => {
    const row = d.prepare(
      "SELECT * FROM reviews WHERE diff_hash = ? ORDER BY created_at DESC LIMIT 1"
    ).get(diffHash);
    if (row) return { reviewId: row.id, existing: true };

    const id = randomUUID();
    d.prepare("INSERT INTO reviews (...) VALUES (?, ?, ?)")
      .run(id, diffHash, trigger);
    return { reviewId: id, existing: false };
  })();
  return result;
}
```
Atomically checks and inserts to prevent race conditions.

### 3. Lenient JSONL Parser
```ts
const findingRegex =
  /\[(CRITICAL|WARNING|INFO)]\s+(?:(\S+?)(?::(\d+(?:-\d+)?))?\s+[—–-]\s+)?(.+)/gi;

for (const match of textToParse.matchAll(findingRegex)) {
  // Extract: severity, filePath, lineRange, message
  // Gracefully skip non-matching lines
}
```
Tolerates minor format variations and ignores malformed lines.

### 4. Graceful Error Handling
- Codex timeout → SIGTERM + error message
- Codex not found → Promise rejection with helpful message
- Auth errors detected from stderr
- Non-zero exit codes logged with stderr
- Database errors throw with context

## Testing

**Test file:** `test/integration-test.ts` (custom node:assert runner)

**Scenarios:**
1. Database CRUD (insert, query, resolve findings)
2. Diff hashing and dedup
3. JSONL parsing with various formats
4. CLI commands (check-unresolved, status)
5. Hook debounce logic

**Run:** `npm test`

## Build & Runtime

**Build:** `npm run build` → TypeScript compiled to `dist/`

**Runtime:**
- MCP server: `node dist/mcp-server.js`
- CLI: `node dist/cli.js`
- Hooks: bash scripts + node CLI calls

**Environment:**
- Node.js >=20.0.0
- Codex CLI required in PATH
- Git repo with .git directory
- SQLite 3 (bundled with better-sqlite3)

## Dependencies & Versions

```json
{
  "@modelcontextprotocol/sdk": "^1.28.0",
  "better-sqlite3": "^12.8.0"
}
```

**Dev:**
- `@types/better-sqlite3`: Type definitions
- `@types/node`: Node.js types
- `tsx`: TypeScript executor for tests
- `typescript`: Compiler

## File Size & Modularity

| File | LOC | Cohesion | Notes |
|------|-----|----------|-------|
| mcp-server.ts | 193 | High | 4 tools, each focused |
| codex-runner.ts | 279 | High | Parsing + spawning + queue |
| database.ts | 239 | High | Schema + CRUD + queries |
| cli.ts | 83 | High | Two commands, clean split |
| diff-hasher.ts | 48 | High | Single responsibility |

All files below 300 LOC, ready for production. No splitting needed.

## Error Handling Strategy

| Scenario | Handler | User Sees |
|----------|---------|-----------|
| Codex timeout | SIGTERM + reject | Error in review result |
| Codex not found | spawn error → reject | Helpful message + exit code |
| Auth error | stderr parse → resolve with error | Error in review result |
| DB corruption | transaction rollback + throw | Error in MCP tool response |
| Finding not found | throw + catch | Error response with finding_id |
| Invalid severity (CLI) | validate + exit 1 | Usage message |
| No git repo | execSync error → ignore | Random hash (H3 fix) |
