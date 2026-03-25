#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  getFindings,
  resolveFinding,
  getBridgeStats,
  closeDb,
} from "./database.js";
import { requestReview, isReviewRunning } from "./codex-runner.js";

// --- Server setup ---

const server = new McpServer({
  name: "claude-peer-pressure",
  version: "0.1.0",
});

// --- Tool: bridge_request_review ---

server.tool(
  "bridge_request_review",
  "Trigger a Codex code review on current uncommitted changes",
  {
    trigger: z
      .enum(["hook", "manual", "pre-commit"])
      .optional()
      .default("manual")
      .describe("What triggered the review"),
  },
  async ({ trigger }) => {
    try {
      const result = await requestReview(trigger);
      const status = result.cached ? "cached" : result.error ? "error" : "started";
      const message = result.cached
        ? `Review already exists for this diff (id: ${result.reviewId})`
        : result.error
          ? `Review completed with error: ${result.error}`
          : `Review completed with ${result.findings.length} finding(s)`;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { review_id: result.reviewId, status, message },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              review_id: null,
              status: "error",
              message: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: bridge_get_findings ---

server.tool(
  "bridge_get_findings",
  "List code review findings from the database",
  {
    status: z
      .enum(["open", "resolved", "rejected", "all"])
      .optional()
      .default("open")
      .describe("Filter findings by status"),
    review_id: z
      .string()
      .optional()
      .describe("Filter findings by review ID"),
  },
  async ({ status, review_id }) => {
    const findings = getFindings({ status, reviewId: review_id });
    const hasCritical = findings.some((f) => f.severity === "critical");

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { findings, total: findings.length, has_critical: hasCritical },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// --- Tool: bridge_resolve_finding ---

server.tool(
  "bridge_resolve_finding",
  "Mark a finding as resolved or rejected",
  {
    finding_id: z.number().describe("The finding ID to update"),
    action: z
      .enum(["resolved", "rejected"])
      .describe("Whether the finding was resolved or rejected"),
    resolution: z
      .string()
      .optional()
      .describe("Reason for resolution/rejection"),
  },
  async ({ finding_id, action, resolution }) => {
    try {
      resolveFinding(finding_id, action, resolution);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, finding_id }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: false,
              finding_id,
              error: err instanceof Error ? err.message : String(err),
            }),
          },
        ],
        isError: true,
      };
    }
  },
);

// --- Tool: bridge_status ---

server.tool(
  "bridge_status",
  "Check bridge status: running reviews, last review, finding counts, Codex availability",
  {},
  async () => {
    const stats = getBridgeStats();
    const reviewRunning = isReviewRunning();

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              review_in_progress: reviewRunning,
              ...stats,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// --- Graceful shutdown ---

function shutdown(): void {
  closeDb();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
