# claude-peer-pressure: Code Standards

## Language & Tooling

- **Language:** TypeScript (strict mode)
- **Module System:** ESM (ECMAScript modules)
- **Target:** Node.js >=20.0.0, ES2022
- **Compiler:** `tsc` with strict mode enabled
- **Build Output:** `dist/` (declaration maps + source maps)

## File Organization

### Naming Conventions

| File Type | Convention | Example |
|-----------|-----------|---------|
| TypeScript | kebab-case | `diff-hasher.ts`, `codex-runner.ts` |
| Bash | kebab-case | `pre-commit.sh`, `post-tool-use-review-trigger.sh` |
| JSON | kebab-case | `tsconfig.json`, `package.json` |
| Directories | kebab-case | `src/`, `test/`, `hooks/` |

### Directory Structure

```
root/
├── src/                    # Main source code
│   ├── mcp-server.ts      # MCP server definition
│   ├── codex-runner.ts    # Codex spawning & parsing
│   ├── database.ts        # SQLite persistence
│   ├── cli.ts             # Hook CLI
│   └── diff-hasher.ts     # Diff deduplication
├── dist/                  # Build output (gitignored)
├── test/                  # Integration tests
│   └── integration-test.ts
├── hooks/                 # Git & Claude hooks
│   ├── pre-commit.sh
│   ├── post-tool-use-review-trigger.sh
│   └── stop-findings-check.sh
├── package.json
├── tsconfig.json
├── README.md
└── docs/
    ├── project-overview-pdr.md
    ├── codebase-summary.md
    ├── code-standards.md
    ├── system-architecture.md
    └── project-roadmap.md
```

## TypeScript Standards

### Compiler Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

**Key constraints:**
- `strict: true` — all strict checks enabled
- No implicit `any`
- Strict null checks
- Strict function types
- Strict binding of `this`

### Import/Export

**ESM modules only:**
```ts
import { Type, function } from "./module.js";
import type { TypeOnly } from "./types.js";

export type Finding = { ... };
export const myFunction = (): void => { ... };
export function anotherFunction(): string { ... }
```

**Rules:**
- Use `.js` extension in imports (Node.js requires it for ESM)
- Use `import type { }` for type-only imports
- Default exports avoided (use named exports)
- Export interfaces/types alongside implementations

### Naming Conventions

| Entity | Convention | Example |
|--------|-----------|---------|
| Functions | camelCase | `computeDiffHash()`, `getFindings()` |
| Constants | UPPER_CASE | `REVIEW_TIMEOUT_MS`, `MAX_BUFFER` |
| Types/Interfaces | PascalCase | `Review`, `Finding`, `ReviewResult` |
| Variables | camelCase | `running`, `dbPath`, `findings` |
| Private fields | camelCase with `#` | `#dbPath`, `#cache` |
| Classes | PascalCase | `Database` (used via better-sqlite3) |

### Type Annotations

**Always explicit:**
```ts
// Good
function getFindings(query: FindingsQuery = {}): Finding[] {
  const d = getDb();
  const { status = "open", reviewId, severity } = query;
  // ...
}

// Good
const findings: ParsedFinding[] = [];
const timer = setTimeout(() => { ... }, REVIEW_TIMEOUT_MS);

// Good
async function executeReview(
  trigger: "hook" | "manual" | "pre-commit",
  resolve: (r: ReviewResult) => void,
): Promise<void> { ... }

// Avoid
const findings = []; // Type inferred, less clear
function getStuff(x) { ... } // No types
```

### Error Handling

**Always use try-catch for async operations:**

```ts
try {
  const result = await requestReview(trigger);
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
} catch (err) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: err.message }) }],
    isError: true,
  };
}
```

**Throw meaningful errors:**
```ts
// Good
throw new Error(`Finding ${findingId} not found`);
throw new Error(`Codex review timed out after 120s`);

// Avoid
throw "error";
throw { error: "something" };
```

**Graceful degradation:**
```ts
try {
  parts.push(execSync("git diff --cached", { ... }));
} catch {
  // not a git repo or no staged changes — ignore
}
```

### Interfaces & Types

**Prefer interfaces for external APIs:**
```ts
export interface Review {
  id: string;
  diff_hash: string;
  trigger: "hook" | "manual" | "pre-commit";
  codex_output: string | null;
  finding_count: number;
  created_at: string;
}

export interface FindingsQuery {
  status?: "open" | "resolved" | "rejected" | "all";
  reviewId?: string;
  severity?: Finding["severity"];
}
```

**Use literal types for enums:**
```ts
// Good
type Severity = "critical" | "warning" | "info";
type Status = "open" | "resolved" | "rejected";

// Also acceptable but less type-safe
const severities = ["critical", "warning", "info"] as const;
type Severity = typeof severities[number];
```

## Comments & Documentation

### File Header Comments

Not required for trivial files, use for complex modules:

```ts
/**
 * Codex peer review runner with single-queue execution.
 *
 * Spawns `codex exec review --uncommitted` and parses JSONL findings.
 * Deduplicates by diff hash. Queues if a review is already running.
 * Newer requests supersede queued ones.
 */
```

### Function Documentation

Use JSDoc for public exports:

```ts
/**
 * Request a code review via Codex CLI.
 * Deduplicates by diff hash. Queues if a review is already running.
 *
 * @param trigger - What triggered the review ("hook" | "manual" | "pre-commit")
 * @returns Review result with ID, cached status, findings, and optional error
 */
export function requestReview(
  trigger: "hook" | "manual" | "pre-commit",
): Promise<ReviewResult> { ... }
```

### Inline Comments

Use sparingly, only for non-obvious logic:

```ts
// Transaction-based dedup (C1 fix — prevents race condition)
const { reviewId, existing } = insertReviewIfNew(diffHash, trigger);
if (existing) {
  resolve({ reviewId, cached: true, findings: [] });
  return;
}

// Parse lines matching: [SEVERITY] file:line — message
const findingRegex = /\[(CRITICAL|WARNING|INFO)]\s+(?:(\S+?)(?::(\d+(?:-\d+)?))?\s+[—–-]\s+)?(.+)/gi;
```

**Avoid obvious comments:**
```ts
// Bad: just repeats code
x = x + 1; // increment x

// Bad: incorrect after refactor (stale)
const findings = []; // Array of parsed findings (outdated)

// Good: explains why
const findings = []; // Skips "no issues found" placeholder from Codex
```

## Database Standards

### SQL Conventions

**Schema naming:**
- Table names: lowercase, plural (`reviews`, `findings`)
- Column names: lowercase, snake_case (`diff_hash`, `finding_count`)
- Primary keys: `id` (type-specific: TEXT or INTEGER)
- Foreign keys: `{table}_id` format (`review_id`)
- Indexes: `idx_{table}_{column}` format

**Query style:**
```ts
// Parameterized queries (always)
db.prepare("SELECT * FROM findings WHERE status = ? AND severity = ?")
  .all(status, severity);

// Never string concatenation
// db.prepare(`SELECT * FROM findings WHERE status = '${status}'`) // WRONG!
```

### Transactions

**Use for atomic operations:**
```ts
const result = d.transaction(() => {
  const row = d.prepare("SELECT * FROM reviews WHERE diff_hash = ?").get(diffHash);
  if (row) return { reviewId: row.id, existing: true };

  const id = randomUUID();
  d.prepare("INSERT INTO reviews (id, diff_hash, trigger) VALUES (?, ?, ?)")
    .run(id, diffHash, trigger);
  return { reviewId: id, existing: false };
})();
```

**Benefits:**
- Atomicity: all or nothing
- Consistency: no partial state
- Isolation: thread-safe in WAL mode

## Testing Standards

### Test Framework

**No external framework.** Use Node.js built-in `assert`:

```ts
import assert from "node:assert";

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

test("Insert finding", () => {
  const id = insertFinding(reviewId, "critical", "SQL injection", "app.js", "3");
  assert.ok(id > 0);
  assert.strictEqual(typeof id, "number");
});
```

### Test Organization

- **File location:** `test/integration-test.ts`
- **Scenarios:** Group related tests under descriptive headings
- **Setup/teardown:** Use helper functions
- **Focus:** Integration tests that verify module interaction

**Example structure:**
```ts
setup(); // Clean test directory

console.log("\nScenario 1: Database CRUD");
const db = await import("../src/database.js");
db.getDb(TEST_DB);

test("Insert review", () => { ... });
test("Find review by diff hash", () => { ... });
test("Filter findings by severity", () => { ... });

console.log("\nScenario 2: Diff Hashing");
test("Compute hash from diffs", () => { ... });

teardown(); // Clean up
```

### Test Expectations

- **Run:** `npm test`
- **Exit code:** 0 if all tests pass, >0 otherwise
- **Output:** Human-readable PASS/FAIL lines
- **Coverage:** Database, parser, CLI, dedup, hooks

## Error Codes & Exit Codes

### Process Exit Codes

| Code | Meaning | Context |
|------|---------|---------|
| 0 | Success | Review complete, tests pass, CLI success |
| 1 | Failure | Critical findings found, test failed, invalid CLI args |
| 2+ | Reserved | (not used in v0.1.0) |

### HTTP-like Response Patterns

MCP tools return JSON (no HTTP codes):

```ts
// Success
{ success: true, finding_id, ... }

// Error
{ success: false, finding_id, error: "message" }

// Status
{ review_in_progress: boolean, total_reviews: number, ... }
```

## Security Standards

### Input Validation

**Zod schemas for MCP parameters:**
```ts
server.tool(
  "bridge_resolve_finding",
  "Mark a finding as resolved or rejected",
  {
    finding_id: z.number().describe("The finding ID to update"),
    action: z.enum(["resolved", "rejected"]).describe("..."),
    resolution: z.string().optional().describe("..."),
  },
  async ({ finding_id, action, resolution }) => {
    // Zod validates before reaching handler
  },
);
```

**Manual validation where needed:**
```ts
// cli.ts
const validSeverities: Finding["severity"][] = ["critical", "warning", "info"];
if (rawSeverity && !validSeverities.includes(rawSeverity as Finding["severity"])) {
  console.error(`Invalid severity: ${rawSeverity}`);
  process.exit(1);
}
```

### No String Interpolation for Commands

**Safe:**
```ts
const args = ["exec", "review", "--uncommitted", "--json", "--ephemeral"];
const child = spawn("codex", args);
```

**Never:**
```ts
// NEVER! Shell injection risk
spawn(`codex exec review --uncommitted`, { shell: true });
```

### Sensitive Data

**Never log:**
- API keys or auth tokens
- Database paths (log error context only)
- User file paths in detail

**Example (safe):**
```ts
console.error(`Codex auth error: ${stderr.trim()}`);
// stderr may contain token — OK because it's not echoed publicly
```

## Performance Standards

### Timeouts

**Codex review timeout:** 120 seconds (non-negotiable)
```ts
const REVIEW_TIMEOUT_MS = 120_000;
const timer = setTimeout(() => child.kill("SIGTERM"), REVIEW_TIMEOUT_MS);
```

### Buffer Management

**Limit execSync output:** 10MB max
```ts
const MAX_BUFFER = 10 * 1024 * 1024;
execSync("git diff --cached", { encoding: "utf-8", maxBuffer: MAX_BUFFER });
```

### Database Indexes

**Must have:**
- `idx_reviews_diff_hash` — for dedup checks
- `idx_findings_status` — for filtering open findings
- `idx_findings_review` — for querying by review_id

## Logging & Debugging

### Console Output

**MCP server:**
- No console output (runs as stdio transport)
- Logs go to stderr via MCP SDK

**CLI:**
```ts
console.log(`Open findings: ${findings.length}`);
for (const f of findings) {
  console.log(`  [${f.severity.toUpperCase()}] ${loc} — ${f.message}`);
}
```

**Hooks:**
```bash
echo "BLOCKED: Codex found critical unresolved findings:"
echo "$RESULT"
```

### Debugging Tips

- **Database path mismatch:** Check `database.ts::getDb()` singleton
- **Codex timeout:** Reduce diff size or increase 120s limit
- **Parser not finding findings:** Check Codex output format (JSONL vs text)
- **Pre-commit not triggered:** Verify `.git/hooks/pre-commit` is executable
- **Dedup not working:** Check diff hash collision (should be rare)

## Build & Deployment

### Compilation

```bash
npm run build
# Output: dist/*.js, dist/*.d.ts, dist/*.d.ts.map, dist/*.js.map
```

### Pre-deployment Checks

```bash
npm run build        # Compiles successfully
npm test             # All tests pass
git commit --dry-run # Pre-commit hook validates
```

### Distribution

Not published to npm in v0.1.0. Run from source:
```bash
npm install
npm run build
npm start
```

## Code Review Checklist

- [ ] TypeScript compiles with no errors (`npm run build`)
- [ ] All new functions have type annotations
- [ ] Error handling covers success + failure paths
- [ ] Database queries are parameterized
- [ ] No console.log in production code (CLI excepted)
- [ ] Comments explain non-obvious logic
- [ ] Tests pass (`npm test`)
- [ ] File size <300 LOC (consider modularizing)
- [ ] No `any` types (unless justified)
- [ ] Git hooks updated if API changes

## Linting & Formatting

**No enforced linter in v0.1.0.** Follow these manual standards:

- 2-space indentation
- Semicolons required
- 80-char line length preferred (not enforced)
- No trailing whitespace
- Unix line endings (LF)

**Future:** Consider `eslint` + `prettier` after v0.1.0 stabilizes.

## Deprecation & Cleanup

**Code to avoid:**
- `var` (use `const`/`let`)
- `async` IIFE without try-catch
- Mutable global state (except singletons)
- Promise chains (use async-await)
- Non-null assertions (`!`) without comments

**Example bad patterns:**
```ts
// Avoid
var findings = []; // Use const
db.query(...).then(r => r.data).then(d => console.log(d)); // Chain
const x = getSomething()!; // Unsafe assertion
```
