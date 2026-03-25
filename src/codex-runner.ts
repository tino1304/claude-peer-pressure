import { spawn } from "node:child_process";
import {
  insertReviewIfNew,
  updateReviewOutput,
  insertFinding,
  type Finding,
  type Review,
} from "./database.js";
import { computeDiffHash } from "./diff-hasher.js";

// --- Types ---

export interface ReviewResult {
  reviewId: string;
  cached: boolean;
  findings: ParsedFinding[];
  error?: string;
}

export interface ParsedFinding {
  severity: Finding["severity"];
  message: string;
  filePath?: string;
  lineRange?: string;
}

// --- Constants ---

const REVIEW_TIMEOUT_MS = 120_000;

const REVIEW_PROMPT = [
  "Review as independent reviewer.",
  "Focus on bugs, security, logic errors. Be concise.",
  "Output one finding per line in format: [SEVERITY] file:line — message",
  "Severity: CRITICAL, WARNING, INFO.",
  "If no issues found, output: [INFO] No issues found.",
].join(" ");

// --- Queue state ---

let running = false;
let queued: {
  trigger: "hook" | "manual" | "pre-commit";
  resolve: (r: ReviewResult) => void;
} | null = null;

/** Whether a Codex review is currently in progress. */
export function isReviewRunning(): boolean {
  return running;
}

// --- Public API ---

/**
 * Request a code review via Codex CLI.
 * Deduplicates by diff hash. Queues if a review is already running.
 */
export function requestReview(
  trigger: "hook" | "manual" | "pre-commit",
): Promise<ReviewResult> {
  return new Promise((resolve) => {
    if (running) {
      // Resolve previously queued caller as superseded (M7 fix)
      if (queued) {
        queued.resolve({
          reviewId: "superseded",
          cached: false,
          findings: [],
          error: "Superseded by newer review request",
        });
      }
      queued = { trigger, resolve };
      return;
    }
    void executeReview(trigger, resolve);
  });
}

// --- Internal ---

async function executeReview(
  trigger: "hook" | "manual" | "pre-commit",
  resolve: (r: ReviewResult) => void,
): Promise<void> {
  running = true;

  try {
    // Transaction-based dedup (C1 fix — prevents race condition)
    const diffHash = computeDiffHash();
    const { reviewId, existing } = insertReviewIfNew(diffHash, trigger);
    if (existing) {
      resolve({ reviewId, cached: true, findings: [] });
      return;
    }
    const result = await spawnCodex();

    const findings = parseFindings(result.output);

    // Persist findings
    for (const f of findings) {
      insertFinding(reviewId, f.severity, f.message, f.filePath, f.lineRange);
    }

    updateReviewOutput(reviewId, result.output, findings.length);

    resolve({
      reviewId,
      cached: false,
      findings,
      error: result.error || undefined,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Create a review entry with the error
    try {
      const diffHash = computeDiffHash();
      const { reviewId } = insertReviewIfNew(diffHash, trigger);
      updateReviewOutput(reviewId, `ERROR: ${errorMsg}`, 0);
      resolve({ reviewId, cached: false, findings: [], error: errorMsg });
    } catch {
      resolve({
        reviewId: "error",
        cached: false,
        findings: [],
        error: errorMsg,
      });
    }
  } finally {
    running = false;
    // Process queue
    if (queued) {
      const next = queued;
      queued = null;
      void executeReview(next.trigger, next.resolve);
    }
  }
}

interface CodexOutput {
  output: string;
  error?: string;
}

function spawnCodex(): Promise<CodexOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "review",
      "--uncommitted",
      "--json",
      "--ephemeral",
      "-o",
      ".a2a/tmp/review.txt",
    ];

    const child = spawn("codex", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    const errChunks: string[] = [];

    child.stdout.on("data", (data: Buffer) => chunks.push(data.toString()));
    child.stderr.on("data", (data: Buffer) => errChunks.push(data.toString()));

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Codex review timed out after 120s"));
    }, REVIEW_TIMEOUT_MS);

    child.on("close", (code) => {
      clearTimeout(timer);
      const output = chunks.join("");
      const stderr = errChunks.join("");

      if (code !== 0) {
        // Check for auth errors
        if (stderr.includes("auth") || stderr.includes("API key")) {
          resolve({
            output,
            error: `Codex auth error: ${stderr.trim()}`,
          });
          return;
        }
        resolve({
          output,
          error: `Codex exited with code ${code}: ${stderr.trim()}`,
        });
        return;
      }

      resolve({ output });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Failed to spawn codex: ${err.message}. Is codex installed?`,
        ),
      );
    });
  });
}

// --- JSONL Parser ---

/**
 * Parse Codex JSONL output into structured findings.
 * Lenient: extracts what it can, ignores malformed lines.
 */
export function parseFindings(output: string): ParsedFinding[] {
  const findings: ParsedFinding[] = [];

  // First try parsing JSONL events for assistant messages
  const assistantContent = extractAssistantContent(output);
  const textToParse = assistantContent || output;

  // Parse lines matching: [SEVERITY] file:line — message
  const findingRegex =
    /\[(CRITICAL|WARNING|INFO)]\s+(?:(\S+?)(?::(\d+(?:-\d+)?))?\s+[—–-]\s+)?(.+)/gi;

  for (const match of textToParse.matchAll(findingRegex)) {
    const severity = match[1].toLowerCase() as ParsedFinding["severity"];
    const filePath = match[2] || undefined;
    const lineRange = match[3] || undefined;
    const message = match[4].trim();

    // Skip "no issues" placeholder
    if (message.toLowerCase().includes("no issues found")) continue;

    findings.push({ severity, message, filePath, lineRange });
  }

  return findings;
}

/**
 * Extract assistant message content from JSONL events.
 * Codex --json emits newline-delimited JSON with event types.
 */
function extractAssistantContent(jsonlOutput: string): string {
  const contentParts: string[] = [];

  for (const line of jsonlOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);

      // Look for message events with assistant role
      if (event.type === "message" && event.role === "assistant") {
        if (typeof event.content === "string") {
          contentParts.push(event.content);
        } else if (Array.isArray(event.content)) {
          for (const block of event.content) {
            if (block.type === "text" && typeof block.text === "string") {
              contentParts.push(block.text);
            }
          }
        }
      }

      // Also check for content_block events
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        contentParts.push(event.delta.text);
      }
    } catch {
      // Not valid JSON — skip
    }
  }

  return contentParts.join("");
}
