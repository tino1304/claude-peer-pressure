import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// --- Types ---

export interface Review {
  id: string;
  diff_hash: string;
  trigger: "hook" | "manual" | "pre-commit";
  codex_output: string | null;
  finding_count: number;
  created_at: string;
}

export interface Finding {
  id: number;
  review_id: string;
  severity: "critical" | "warning" | "info";
  message: string;
  file_path: string | null;
  line_range: string | null;
  status: "open" | "resolved" | "rejected";
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface FindingsQuery {
  status?: "open" | "resolved" | "rejected" | "all";
  reviewId?: string;
  severity?: Finding["severity"];
}

// --- Schema ---

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  diff_hash TEXT NOT NULL,
  trigger TEXT NOT NULL,
  codex_output TEXT,
  finding_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_diff_hash ON reviews(diff_hash);

CREATE TABLE IF NOT EXISTS findings (
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
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_review ON findings(review_id);
`;

// --- Database singleton (H1 fix: path mismatch detection) ---

let db: Database.Database | null = null;
let dbPathUsed: string | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) {
    if (dbPath && dbPathUsed !== dbPath) {
      throw new Error(
        `DB already initialized at "${dbPathUsed}", cannot re-init at "${dbPath}"`,
      );
    }
    return db;
  }
  dbPath ??= ".a2a/bridge.db";

  dbPathUsed = dbPath;
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbPathUsed = null;
  }
}

// --- Query helpers ---

/**
 * Transaction-based insert-or-return for reviews (C1 fix — prevents race condition).
 * Returns existing review if diff_hash already has one, otherwise creates new.
 */
export function insertReviewIfNew(
  diffHash: string,
  trigger: Review["trigger"],
): { reviewId: string; existing: boolean } {
  const d = getDb();
  const result = d.transaction(() => {
    const row = d
      .prepare(
        "SELECT * FROM reviews WHERE diff_hash = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(diffHash) as Review | undefined;
    if (row) return { reviewId: row.id, existing: true };

    const id = randomUUID();
    d.prepare(
      "INSERT INTO reviews (id, diff_hash, trigger) VALUES (?, ?, ?)",
    ).run(id, diffHash, trigger);
    return { reviewId: id, existing: false };
  })();
  return result;
}

export function updateReviewOutput(
  reviewId: string,
  codexOutput: string,
  findingCount: number,
): void {
  getDb()
    .prepare(
      "UPDATE reviews SET codex_output = ?, finding_count = ? WHERE id = ?",
    )
    .run(codexOutput, findingCount, reviewId);
}

export function insertFinding(
  reviewId: string,
  severity: Finding["severity"],
  message: string,
  filePath?: string | null,
  lineRange?: string | null,
): number {
  const result = getDb()
    .prepare(
      `INSERT INTO findings (review_id, severity, message, file_path, line_range)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(reviewId, severity, message, filePath ?? null, lineRange ?? null);
  return Number(result.lastInsertRowid);
}

/**
 * Query findings with optional filters (M2/M3 fix — single query source).
 */
export function getFindings(query: FindingsQuery = {}): Finding[] {
  const d = getDb();
  const { status = "open", reviewId, severity } = query;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status !== "all") {
    conditions.push("status = ?");
    params.push(status);
  }
  if (reviewId) {
    conditions.push("review_id = ?");
    params.push(reviewId);
  }
  if (severity) {
    conditions.push("severity = ?");
    params.push(severity);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return d
    .prepare(`SELECT * FROM findings ${where} ORDER BY id`)
    .all(...params) as Finding[];
}

/** Convenience: get open findings, optionally filtered by severity. */
export function getOpenFindings(severity?: Finding["severity"]): Finding[] {
  return getFindings({ status: "open", severity });
}

/**
 * Resolve/reject a finding (H2 fix — throws if finding not found).
 */
export function resolveFinding(
  findingId: number,
  status: "resolved" | "rejected",
  resolution?: string,
): void {
  const result = getDb()
    .prepare(
      `UPDATE findings SET status = ?, resolution = ?, resolved_at = datetime('now')
       WHERE id = ?`,
    )
    .run(status, resolution ?? null, findingId);
  if (result.changes === 0) {
    throw new Error(`Finding ${findingId} not found`);
  }
}

export interface BridgeStats {
  total_reviews: number;
  total_findings: number;
  open_findings: number;
  critical_open: number;
  last_review: { id: string; created_at: string; finding_count: number } | null;
}

/** Aggregate stats for the bridge status tool. */
export function getBridgeStats(): BridgeStats {
  const d = getDb();
  const totals = d.prepare(`
    SELECT
      (SELECT COUNT(*) FROM reviews) AS total_reviews,
      (SELECT COUNT(*) FROM findings) AS total_findings,
      (SELECT COUNT(*) FROM findings WHERE status = 'open') AS open_findings,
      (SELECT COUNT(*) FROM findings WHERE status = 'open' AND severity = 'critical') AS critical_open
  `).get() as { total_reviews: number; total_findings: number; open_findings: number; critical_open: number };

  const lastReview = d.prepare(
    "SELECT id, created_at, finding_count FROM reviews ORDER BY created_at DESC LIMIT 1",
  ).get() as { id: string; created_at: string; finding_count: number } | undefined;

  return { ...totals, last_review: lastReview ?? null };
}

export function findReviewByDiffHash(diffHash: string): Review | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM reviews WHERE diff_hash = ? ORDER BY created_at DESC LIMIT 1",
    )
    .get(diffHash) as Review | undefined;
}
