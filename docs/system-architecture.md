# claude-peer-pressure: System Architecture

## Overview

claude-peer-pressure is a modular system that integrates peer code review (via Codex LLM) into Claude Code's development workflow. It consists of 5 core components connected via a shared SQLite database.

```
┌──────────────────────────────────────────────────────────────┐
│                         Claude Code                          │
│  (User edits code with Edit, Write, MultiEdit tools)         │
└────────────────────┬─────────────────────────────────────────┘
                     │
                     │ PostToolUse Hook
                     │
         ┌───────────▼──────────────┐
         │ post-tool-use-review     │
         │ trigger.sh (debounce)    │
         │ (30s window)             │
         └───────────┬──────────────┘
                     │
                     │ bridge_request_review
                     │ (MCP Tool)
                     │
      ┌──────────────▼──────────────────────┐
      │    MCP Server (stdio transport)     │
      │  - bridge_request_review            │
      │  - bridge_get_findings              │
      │  - bridge_resolve_finding           │
      │  - bridge_status                    │
      └──────────────┬──────────────────────┘
                     │
      ┌──────────────▼──────────────────────┐
      │      codex-runner.ts                │
      │ (single-queue execution, parser)    │
      │                                     │
      │  1. computeDiffHash()               │
      │  2. insertReviewIfNew()             │
      │  3. spawnCodex CLI                  │
      │  4. parseFindings(JSONL)            │
      │  5. updateReviewOutput()            │
      └──────────────┬──────────────────────┘
                     │
                ┌────▼─────┐
                │Codex LLM │
                └────┬─────┘
                     │
         ┌───────────▼──────────────┐
         │ SQLite Database          │
         │ .a2a/bridge.db (WAL)     │
         │                          │
         │  reviews table           │
         │  findings table          │
         │  (indexes, FKs)          │
         └───────────┬──────────────┘
                     │
      ┌──────────────┴──────────────────────┐
      │  CLI & Hook Scripts                 │
      │  - check-unresolved --block         │
      │  - check-unresolved --count         │
      │  - pre-commit.sh (git hook)         │
      │  - stop-findings-check.sh           │
      └─────────────────────────────────────┘
```

## Component Architecture

### 1. MCP Server (`src/mcp-server.ts`)

**Responsibilities:**
- Define MCP tools for Claude Code integration
- Handle stdio transport
- Route tool calls to business logic
- Format responses as JSON
- Graceful shutdown

**Dependencies:** codex-runner, database

**Interfaces:**
```
Tool: bridge_request_review(trigger?) → ReviewResult
Tool: bridge_get_findings(status?, review_id?) → { findings[], total, has_critical }
Tool: bridge_resolve_finding(finding_id, action, resolution?) → { success, finding_id }
Tool: bridge_status() → { review_in_progress, stats... }
```

**Execution Flow:**
1. Claude calls MCP tool
2. Server validates params (Zod schema)
3. Delegates to codex-runner or database
4. Catches errors and formats response
5. Returns JSON to Claude

### 2. Codex Runner (`src/codex-runner.ts`)

**Responsibilities:**
- Maintain single-queue execution state
- Spawn Codex CLI process with timeout
- Parse JSONL output into structured findings
- Handle Codex errors (auth, timeout, not found)
- Return findings to database for persistence

**Key Exports:**
```ts
function requestReview(trigger): Promise<ReviewResult>
function isReviewRunning(): boolean
function parseFindings(output): ParsedFinding[]
```

**State Management:**
```ts
let running = false;      // Is a review in progress?
let queued = null;        // Next review request waiting
```

**Execution Flow (per review):**

```
1. Client calls requestReview()
   ├─ If running = false → executeReview()
   └─ If running = true → queue this request

2. executeReview(trigger, resolve)
   ├─ computeDiffHash() → SHA-256
   ├─ insertReviewIfNew(diffHash, trigger)
   │  └─ If cached → resolve + return
   ├─ spawnCodex(args)
   │  └─ 120s timeout, JSONL output
   ├─ parseFindings(output)
   │  └─ Regex: [SEVERITY] file:line — message
   ├─ insertFinding() × N
   ├─ updateReviewOutput()
   ├─ resolve(ReviewResult)
   └─ Process queued request (if any)
```

**Codex CLI Invocation:**
```bash
codex exec review --uncommitted --json --ephemeral -o .a2a/tmp/review.txt
```

**Output Format (JSONL):**
```json
{"type": "message", "role": "assistant", "content": "..."}
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "[CRITICAL] src/app.ts:15 — SQL injection risk"}}
{"type": "content_block_delta", "delta": {"type": "text_delta", "text": "[WARNING] src/app.ts:22 — Missing null check"}}
```

**Parser Regex:**
```
/\[(CRITICAL|WARNING|INFO)]\s+(?:(\S+?)(?::(\d+(?:-\d+)?))?\s+[—–-]\s+)?(.+)/gi
```
Tolerates em-dash (—), en-dash (–), or hyphen (-).

### 3. Database (`src/database.ts`)

**Responsibilities:**
- SQLite schema definition
- Singleton pattern with path detection
- CRUD operations for reviews and findings
- Transaction-based deduplication
- Query helpers for filtering and aggregation

**Singleton Pattern:**
```ts
let db = null;
let dbPathUsed = null;

export function getDb(dbPath?) {
  if (db) {
    if (dbPath && dbPathUsed !== dbPath) {
      throw new Error(`DB already initialized at "${dbPathUsed}"...`);
    }
    return db;
  }
  // Initialize...
  return db;
}
```

**Schema:**

```sql
reviews (
  id TEXT PRIMARY KEY,
  diff_hash TEXT NOT NULL,
  trigger TEXT NOT NULL,           -- "hook" | "manual" | "pre-commit"
  codex_output TEXT,                -- raw JSONL, nullable if error
  finding_count INTEGER DEFAULT 0,  -- parsed finding count
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_reviews_diff_hash ON reviews(diff_hash);

findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  review_id TEXT NOT NULL REFERENCES reviews(id),
  severity TEXT NOT NULL,           -- "critical" | "warning" | "info"
  message TEXT NOT NULL,            -- description
  file_path TEXT,                   -- source file, nullable
  line_range TEXT,                  -- "3" or "10-15", nullable
  status TEXT DEFAULT 'open',       -- "open" | "resolved" | "rejected"
  resolution TEXT,                  -- reason for resolution, nullable
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT                  -- ISO timestamp when resolved
);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_review ON findings(review_id);
```

**Key Operations:**

| Operation | Type | Purpose |
|-----------|------|---------|
| `insertReviewIfNew(diffHash, trigger)` | Transactional | Dedup: check + insert atomically |
| `insertFinding(reviewId, severity, message, filePath, lineRange)` | Insert | Store parsed finding |
| `getFindings(query)` | Query | Filter by status/reviewId/severity |
| `resolveFinding(findingId, status, resolution)` | Update | Mark resolved/rejected |
| `getBridgeStats()` | Aggregate | Count reviews, findings, criticals |
| `findReviewByDiffHash(diffHash)` | Query | Dedup lookup |

**Transaction Example (C1 fix):**
```ts
const result = d.transaction(() => {
  // Check existing
  const row = d.prepare("SELECT * FROM reviews WHERE diff_hash = ?").get(diffHash);
  if (row) return { reviewId: row.id, existing: true };

  // Insert if not exists
  const id = randomUUID();
  d.prepare("INSERT INTO reviews (...) VALUES (?, ?, ?)").run(id, diffHash, trigger);
  return { reviewId: id, existing: false };
})();
```

### 4. Diff Hasher (`src/diff-hasher.ts`)

**Responsibility:** Compute SHA-256 hash of all uncommitted changes for deduplication.

**Input:**
1. Staged changes: `git diff --cached`
2. Unstaged changes: `git diff`
3. Untracked files: `git ls-files --others --exclude-standard`

**Output:** SHA-256 hex string

**Edge Case (H3 fix):**
If all git commands fail or return empty (e.g., no git repo, pristine working tree), return random hash instead of zeros. Prevents false dedup hits.

```ts
const combined = parts.join("\n");
if (combined.trim().length === 0) {
  return createHash("sha256").update(randomUUID()).digest("hex");
}
return createHash("sha256").update(combined).digest("hex");
```

### 5. CLI (`src/cli.ts`)

**Responsibility:** Lightweight interface for hook scripts to query bridge state.

**Commands:**

| Command | Args | Output | Exit Code |
|---------|------|--------|-----------|
| `check-unresolved` | `--count` | Finding count | 0 |
| `check-unresolved` | `--block` | Critical findings or "No critical" | 1 if critical, else 0 |
| `check-unresolved` | `--severity=X` | Filtered findings | 0 |
| `status` | (none) | Review/finding stats | 0 |

**Example Usage in Hooks:**
```bash
# In pre-commit.sh
RESULT=$($BRIDGE_CLI check-unresolved --block 2>&1)
if [ $? -ne 0 ]; then
  echo "BLOCKED: ${RESULT}"
  exit 1
fi
```

## Data Flow Sequences

### Sequence 1: Review Triggered by Edit

```
1. User Edit in Claude Code
2. PostToolUse hook fires
3. post-tool-use-review-trigger.sh
   └─ Check debounce (30s window)
   └─ Touch .a2a/tmp/review-requested
4. Claude calls bridge_request_review
5. codex-runner queues or executes
6. computeDiffHash() → SHA-256
7. insertReviewIfNew() in transaction
   ├─ Check if review exists for hash
   └─ Create if not (with UUID)
8. spawnCodex("codex exec review --uncommitted --json")
9. Codex LLM analyzes uncommitted changes
10. JSONL output with findings
11. parseFindings() regex extraction
12. insertFinding() for each finding
13. updateReviewOutput(codex_output, finding_count)
14. Resolve promise with ReviewResult
15. Return to MCP → Claude Code
16. Claude can now call bridge_get_findings to see results
```

### Sequence 2: Claude Reviews & Resolves Findings

```
1. Claude calls bridge_get_findings(status="open")
2. Database queries findings WHERE status = 'open'
3. Return findings array with ID, severity, file, line, message
4. Claude reads and decides on each finding
5. Claude calls bridge_resolve_finding(finding_id, "resolved", "reason")
6. Database updates findings SET status='resolved', resolution='...', resolved_at=now()
7. Confirm to Claude via JSON response
8. User continues development or commits
```

### Sequence 3: Commit Blocked by Critical Findings

```
1. User runs: git commit -m "..."
2. Git calls .git/hooks/pre-commit
3. pre-commit.sh executes
4. Calls CLI: node dist/cli.js check-unresolved --block
5. CLI queries getOpenFindings("critical")
6. If any critical findings exist
   └─ Print "[CRITICAL] file:line — message"
   └─ Exit with code 1
7. Git aborts commit with message
8. User either:
   ├─ Resolves findings via bridge_resolve_finding
   └─ Bypasses with git commit --no-verify
```

### Sequence 4: Findings Surfaced on Stop

```
1. User stops Claude Code session
2. Claude Stop hook fires
3. stop-findings-check.sh executes
4. Calls CLI: node dist/cli.js check-unresolved --count
5. CLI queries getOpenFindings() count
6. If count > 0
   └─ Output JSON systemMessage to Claude
7. Claude shows message: "X unresolved finding(s). Run bridge_get_findings..."
```

## Error Handling Strategy

### Error Scenarios & Recovery

| Scenario | Component | Handling |
|----------|-----------|----------|
| Codex CLI not found | codex-runner | Throw with helpful message |
| Codex timeout (>120s) | codex-runner | Kill process, return error |
| Codex auth error | codex-runner | Parse stderr, return error status |
| Malformed JSONL | codex-runner | Lenient parser, extract what's available |
| Database corrupted | database | Transaction rollback, throw |
| Finding not found | database | Throw, caught by MCP tool |
| No git repo | diff-hasher | Catch execSync error, use random hash |
| File permission | hooks | Exit with helpful message |

### Error Propagation

```
codex-runner rejects/returns error
  ↓ caught by MCP tool handler
  ↓
{ review_id: "...", status: "error", message: "...", isError: true }
  ↓
Claude sees error response
  ↓
User can investigate or retry
```

## State Management

### Runtime State (codex-runner.ts)

```ts
let running: boolean;    // Review in progress?
let queued: Request | null;  // Pending request
```

**Transitions:**
```
IDLE → RUNNING (executeReview starts)
RUNNING → IDLE (executeReview completes)
IDLE → IDLE (if queued exists, process it)
```

### Database State

```
Review lifecycle:
  CREATED → PENDING (output null)
          → COMPLETED (output populated, findings inserted)
          → ERROR (output = "ERROR: ...")

Finding lifecycle:
  CREATED (status = 'open')
         → RESOLVED (status = 'resolved', resolved_at set)
         → REJECTED (status = 'rejected', resolved_at set)
```

## Concurrency & Synchronization

### Single-Queue Execution

Only one Codex process runs at a time. Newer requests supersede queued ones.

```ts
// request 1
requestReview("hook") → running=true, execute

// request 2 (while 1 running)
requestReview("hook") → running=true, queued={...}

// request 3 (while 1 running)
requestReview("hook") → running=true, queued={...} (supersede 2)

// request 1 completes
→ process queued (request 3)
```

### Database Synchronization

SQLite WAL mode enables concurrent reads while one process writes:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

**Transaction isolation:** All critical operations (insertReviewIfNew, resolveFinding) wrapped in explicit transactions.

## Scalability & Performance

### Performance Targets

| Operation | Target | Achieved |
|-----------|--------|----------|
| Review spawn → result | <120s | Via Codex timeout |
| DB query (findings) | <100ms | Indexed by status, review_id |
| Dedup check (hash) | <10ms | SHA-256 of diffs |
| Pre-commit hook | <500ms | CLI query + threshold check |

### Limitations

1. **Single-threaded MCP:** One request at a time (by design)
2. **Single Codex process:** Queue-based, not parallel
3. **SQLite WAL:** Good for reads, concurrent writes still serialized
4. **No caching layer:** Every query hits disk (acceptable for <100 findings/session)

### Future Optimizations

- Batch finding insertion (minor perf gain)
- In-memory finding cache with DB sync
- Async finding insertion (queue-based)
- Result compression for large Codex outputs

## Security Considerations

### Threat Model

| Threat | Risk | Mitigation |
|--------|------|-----------|
| SQL injection | High | Parameterized queries only |
| Shell injection | High | spawn(cmd, args[]) not shell=true |
| Unauthorized DB access | Low | Local file permissions + WAL mode |
| Data exfiltration | Low | No remote connectivity, local SQLite only |
| Malicious Codex output | Medium | Lenient parser, no code execution |

### Trust Boundaries

1. **Claude Code ↔ MCP Server:** Zod schema validation
2. **User input (CLI) ↔ Database:** Parameterized queries, enum validation
3. **Codex output ↔ Parser:** Regex extraction, no eval()
4. **Git hooks ↔ System:** Exit codes and messages only

## Deployment Topology

### Single-Instance (v0.1.0)

```
┌─────────────────────┐
│   Claude Code       │
│   (development)     │
├─────────────────────┤
│  MCP Server         │
│  (stdio transport)  │
├─────────────────────┤
│  .a2a/bridge.db     │
│  (local SQLite)     │
└─────────────────────┘
```

### Future Multi-Instance (roadmap)

```
┌──────────────┐         ┌──────────────┐
│ Claude Code  │         │ Claude Code  │
│ Instance 1   │         │ Instance 2   │
└──────┬───────┘         └───────┬──────┘
       │ stdio                   │ stdio
       └─────────┬───────────────┘
                 │
          ┌──────▼──────┐
          │ MCP Server  │ (could use TCP transport)
          │  (shared)   │
          └──────┬──────┘
                 │
          ┌──────▼──────┐
          │ PostgreSQL  │ (replace SQLite)
          │  (remote)   │
          └─────────────┘
```

## Integration Points

### Claude Code Hooks (.claude/settings.local.json)

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

### Git Hooks (.git/hooks/)

```bash
pre-commit → bash hooks/pre-commit.sh
post-commit (optional future)
```

### CLI Invocation

```bash
node dist/cli.js check-unresolved --block
node dist/cli.js status
```

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | >=20.0.0 |
| Language | TypeScript | ^6.0.2 |
| MCP SDK | @modelcontextprotocol/sdk | ^1.28.0 |
| Database | SQLite 3 | (embedded) |
| SQLite Driver | better-sqlite3 | ^12.8.0 |
| Validation | Zod | (via MCP SDK) |
| Testing | node:assert | (built-in) |

## Design Patterns Used

| Pattern | Location | Purpose |
|---------|----------|---------|
| Singleton | database.ts | Ensure one DB connection |
| Queue | codex-runner.ts | Single-execution + backpressure |
| Transaction | database.ts | Atomic dedup check-insert |
| Parser | codex-runner.ts | Lenient JSONL → structured |
| Error envelope | mcp-server.ts | Consistent error format |

## Future Architectural Improvements

1. **Event sourcing** — Audit trail for all finding state changes
2. **Observability** — Metrics/tracing for review latency
3. **Pluggable reviewers** — Provider abstraction for Codex, Claude, local models
4. **Distributed dedup** — Shared cache for multi-instance setup
5. **Incremental reviews** — Only review changed files
