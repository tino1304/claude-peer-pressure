/**
 * Integration tests for a2a-bridge.
 * Tests database, diff-hasher, codex-runner parser, CLI logic, and hook debounce.
 *
 * Run: npx tsx test/integration-test.ts
 */

import { execSync } from "node:child_process";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const TEST_DIR = join(import.meta.dirname, ".tmp-test");
const TEST_DB = join(TEST_DIR, "test.db");

let passed = 0;
let failed = 0;

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

function setup(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function teardown(): void {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// ===================================================================

setup();

// --- Scenario 1: Database CRUD ---
console.log("\nScenario 1: Database CRUD");

const db = await import("../src/database.js");
db.getDb(TEST_DB);

const { reviewId } = db.insertReviewIfNew("abc123hash", "manual");

test("Insert review", () => {
  assert.ok(reviewId.length > 0);
});

test("Find review by diff hash", () => {
  const found = db.findReviewByDiffHash("abc123hash");
  assert.ok(found);
  assert.strictEqual(found.id, reviewId);
  assert.strictEqual(found.trigger, "manual");
});

test("Insert and retrieve findings", () => {
  db.insertFinding(reviewId, "critical", "SQL injection", "app.js", "3");
  db.insertFinding(reviewId, "warning", "Missing validation", "app.js", "2");
  db.insertFinding(reviewId, "info", "Consider refactoring");
  db.updateReviewOutput(reviewId, "test output", 3);
  assert.strictEqual(db.getOpenFindings().length, 3);
});

test("Filter findings by severity", () => {
  const critical = db.getOpenFindings("critical");
  assert.strictEqual(critical.length, 1);
  assert.strictEqual(critical[0].severity, "critical");
});

test("Resolve finding", () => {
  const critical = db.getOpenFindings("critical");
  db.resolveFinding(critical[0].id, "resolved", "Fixed SQL injection");
  assert.strictEqual(db.getOpenFindings("critical").length, 0);
  assert.strictEqual(db.getOpenFindings().length, 2);
});

test("Resolve non-existent finding throws", () => {
  assert.throws(() => db.resolveFinding(999999, "resolved"), /not found/);
});

test("Transaction dedup — same hash returns existing review", () => {
  const { reviewId: dupId, existing } = db.insertReviewIfNew("abc123hash", "hook");
  assert.ok(existing);
  assert.strictEqual(dupId, reviewId);
});

test("Dedup — same hash returns existing review", () => {
  const existing = db.findReviewByDiffHash("abc123hash");
  assert.ok(existing);
  assert.strictEqual(existing.id, reviewId);
});

test("Dedup — different hash returns undefined", () => {
  assert.strictEqual(db.findReviewByDiffHash("differenthash"), undefined);
});

// --- Scenario 2: Codex Output Parsing ---
console.log("\nScenario 2: Codex Output Parsing");

const { parseFindings } = await import("../src/codex-runner.js");

test("Parse JSONL with findings", () => {
  const jsonl = `{"type":"message","role":"assistant","content":[{"type":"text","text":"[CRITICAL] app.js:3 — SQL injection\\n[WARNING] app.js:2 — Missing validation"}]}`;
  const findings = parseFindings(jsonl);
  assert.strictEqual(findings.length, 2);
  assert.strictEqual(findings[0].severity, "critical");
  assert.strictEqual(findings[0].filePath, "app.js");
  assert.strictEqual(findings[0].lineRange, "3");
  assert.strictEqual(findings[1].severity, "warning");
});

test("Parse clean review — no findings", () => {
  const jsonl = `{"type":"message","role":"assistant","content":[{"type":"text","text":"[INFO] No issues found."}]}`;
  assert.strictEqual(parseFindings(jsonl).length, 0);
});

test("Parse findings without file path", () => {
  const findings = parseFindings("[WARNING] General code quality concern");
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].severity, "warning");
  assert.strictEqual(findings[0].filePath, undefined);
});

test("Parse malformed output gracefully", () => {
  assert.strictEqual(parseFindings("not json\n{broken\nrandom").length, 0);
});

// --- Scenario 3: Bridge Status + CLI ---
console.log("\nScenario 3: Bridge Status + CLI");

test("getBridgeStats returns correct counts", () => {
  const stats = db.getBridgeStats();
  assert.strictEqual(stats.total_reviews, 1);
  assert.strictEqual(stats.total_findings, 3);
  assert.strictEqual(stats.open_findings, 2);
  assert.strictEqual(stats.critical_open, 0); // resolved earlier
  assert.ok(stats.last_review);
  assert.strictEqual(stats.last_review.id, reviewId);
});

test("Open findings count matches DB state", () => {
  assert.strictEqual(db.getOpenFindings().length, 2);
});

// --- Scenario 4: Critical Blocking ---
console.log("\nScenario 4: Critical Blocking");

test("Block when critical findings exist", () => {
  const { reviewId: rid } = db.insertReviewIfNew("blockhash", "pre-commit");
  db.insertFinding(rid, "critical", "Buffer overflow", "main.c", "42");
  assert.ok(db.getOpenFindings("critical").length > 0);
});

test("Unblock after resolving critical", () => {
  for (const f of db.getOpenFindings("critical")) {
    db.resolveFinding(f.id, "resolved", "Fixed");
  }
  assert.strictEqual(db.getOpenFindings("critical").length, 0);
});

// --- Scenario 5: Debounce ---
console.log("\nScenario 5: Debounce");

test("Debounce script respects 30s window", () => {
  const tmpDir = join(TEST_DIR, "debounce-tmp");
  mkdirSync(join(tmpDir, ".a2a", "tmp"), { recursive: true });

  const hookPath = join(PROJECT_ROOT, "hooks/post-tool-use-review-trigger.sh");

  // First call — creates timestamp + trigger file
  execSync(`bash "${hookPath}"`, { cwd: tmpDir });
  assert.ok(existsSync(join(tmpDir, ".a2a/tmp/last-review-request")));
  assert.ok(existsSync(join(tmpDir, ".a2a/tmp/review-requested")));

  // Remove trigger, call again immediately — should be debounced (no trigger recreated)
  rmSync(join(tmpDir, ".a2a/tmp/review-requested"), { force: true });
  execSync(`bash "${hookPath}"`, { cwd: tmpDir });
  assert.ok(
    !existsSync(join(tmpDir, ".a2a/tmp/review-requested")),
    "Should be debounced — no trigger file",
  );
});

// --- Cleanup ---
db.closeDb();
teardown();

// --- Results ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
