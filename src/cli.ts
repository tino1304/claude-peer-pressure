#!/usr/bin/env node

/**
 * Lightweight CLI for hook scripts to query bridge state.
 *
 * Usage:
 *   node dist/cli.js check-unresolved --count     Print open finding count
 *   node dist/cli.js check-unresolved --block      Exit 1 if critical findings exist
 *   node dist/cli.js check-unresolved --severity=critical  Filter by severity
 */

import { getOpenFindings, getBridgeStats, closeDb, type Finding } from "./database.js";

const args = process.argv.slice(2);
const command = args[0];

if (command === "check-unresolved") {
  const countOnly = args.includes("--count");
  const block = args.includes("--block");
  const severityArg = args.find((a) => a.startsWith("--severity="));

  // M1 fix: validate severity
  const validSeverities: Finding["severity"][] = ["critical", "warning", "info"];
  const rawSeverity = severityArg?.split("=")[1];
  let severity: Finding["severity"] | undefined;
  if (rawSeverity) {
    if (!validSeverities.includes(rawSeverity as Finding["severity"])) {
      console.error(`Invalid severity: ${rawSeverity}. Use: critical, warning, info`);
      closeDb();
      process.exit(1);
    }
    severity = rawSeverity as Finding["severity"];
  }

  const findings = getOpenFindings(severity);

  if (countOnly) {
    console.log(findings.length);
  } else if (block) {
    const critical = findings.filter((f) => f.severity === "critical");
    if (critical.length > 0) {
      console.error(
        `${critical.length} critical finding(s) must be resolved before commit.`,
      );
      for (const f of critical) {
        const loc = f.file_path
          ? `${f.file_path}${f.line_range ? `:${f.line_range}` : ""}`
          : "(no location)";
        console.error(`  [CRITICAL] ${loc} — ${f.message}`);
      }
      closeDb();
      process.exit(1);
    }
    console.log("No critical findings.");
  } else {
    // Default: print summary
    console.log(`Open findings: ${findings.length}`);
    for (const f of findings) {
      const loc = f.file_path
        ? `${f.file_path}${f.line_range ? `:${f.line_range}` : ""}`
        : "(no location)";
      console.log(`  [${f.severity.toUpperCase()}] ${loc} — ${f.message}`);
    }
  }

  closeDb();
} else if (command === "status") {
  const stats = getBridgeStats();
  console.log(`a2a-bridge status:`);
  console.log(`  Reviews: ${stats.total_reviews}`);
  console.log(`  Findings: ${stats.total_findings} total, ${stats.open_findings} open (${stats.critical_open} critical)`);
  if (stats.last_review) {
    console.log(`  Last review: ${stats.last_review.created_at} (${stats.last_review.finding_count} findings)`);
  } else {
    console.log(`  Last review: none`);
  }
  closeDb();
} else {
  console.error("Usage: a2a-cli <command>");
  console.error("  check-unresolved [--count|--block|--severity=critical|warning|info]");
  console.error("  status");
  process.exit(1);
}
