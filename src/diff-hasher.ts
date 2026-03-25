import { createHash, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const MAX_BUFFER = 10 * 1024 * 1024; // 10MB (M4 fix)

/**
 * Collects staged + unstaged + untracked file diffs and returns a SHA-256 hash.
 * Returns a random hash if no git data available (H3 fix — prevents false cache hits).
 */
export function computeDiffHash(): string {
  const parts: string[] = [];

  try {
    parts.push(
      execSync("git diff --cached", { encoding: "utf-8", maxBuffer: MAX_BUFFER }),
    );
  } catch {
    // not a git repo or no staged changes
  }

  try {
    parts.push(
      execSync("git diff", { encoding: "utf-8", maxBuffer: MAX_BUFFER }),
    );
  } catch {
    // ignore
  }

  try {
    parts.push(
      execSync("git ls-files --others --exclude-standard", {
        encoding: "utf-8",
        maxBuffer: MAX_BUFFER,
      }),
    );
  } catch {
    // ignore
  }

  const combined = parts.join("\n");

  // If all git commands failed or returned empty, use random hash to prevent false dedup
  if (combined.trim().length === 0) {
    return createHash("sha256").update(randomUUID()).digest("hex");
  }

  return createHash("sha256").update(combined).digest("hex");
}
