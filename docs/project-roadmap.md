# claude-peer-pressure: Project Roadmap

## Version History & Milestones

### v0.1.0 — Initial Implementation (2026-03-26)

**Status:** COMPLETE

**Scope:**
- Codex integration via CLI spawning
- SQLite persistence (reviews + findings)
- 4 MCP tools (request, get, resolve, status)
- Git pre-commit hook blocking
- Claude hook debouncing (30s window)
- Diff deduplication via SHA-256
- Integration test suite
- Comprehensive documentation

**Features Delivered:**
- ✅ Automatic Codex review on code edits
- ✅ Finding storage with status tracking
- ✅ Claude can review and resolve findings
- ✅ Git blocking on critical findings
- ✅ Pre-commit hook with bypass option
- ✅ Stop hook surfaces finding count

**Known Limitations:**
- Single Codex provider (no alternatives)
- Lenient JSONL parser (may miss some findings)
- No finding categories or custom severity
- No web dashboard
- No retries on Codex failure

**Metrics:**
- Code: 839 lines (src + hooks)
- Tests: 198 lines (integration)
- Docs: 2000+ lines (5 files)
- Dependencies: 2 (sdk, better-sqlite3)

---

## v0.2.0 — Enhanced Severity & Customization (Planned)

**Target:** Q2 2026 | Duration: 2-3 weeks

**Goals:**
- Configurable review prompts per severity
- Finding categories (security, performance, style, logic)
- Improved parser for edge cases
- Batch resolution workflows

**Proposed Features:**

### F1: Custom Review Prompts
```ts
// .a2a/review-config.json (or env vars)
{
  "prompts": {
    "default": "Review as independent reviewer. Focus on bugs, security, logic errors. Be concise.",
    "security": "Security-focused review: injection, auth, crypto, data leaks.",
    "performance": "Performance review: algorithms, memory, I/O bottlenecks."
  },
  "severity_thresholds": {
    "critical": ["security:injection", "security:auth", "logic:infinite-loop"],
    "warning": ["style:naming", "performance:inefficient"]
  }
}
```

### F2: Finding Categories
```ts
interface Finding {
  // ... existing fields
  category?: "security" | "performance" | "style" | "logic" | "testing";
}
```

### F3: Batch Resolution
```ts
// New MCP tool
bridge_batch_resolve_findings({
  review_id?: string,
  category?: string,
  action: "resolved" | "rejected",
  reason: string
}) → { resolved_count, affected_ids[] }
```

### F4: Better Parser
- Handle indented output (code examples in findings)
- Extract severity from more formats
- Link findings to commit history

**Implementation Plan:**
1. Add config file support (JSON + env vars)
2. Enhance Finding interface with category
3. Add batch resolution tool
4. Improve JSONL parser robustness
5. Update tests for new features
6. Document configuration guide

**Success Criteria:**
- Config loads without errors
- Custom prompts sent to Codex
- Category filtering works in CLI
- Batch resolution updates 10+ findings <500ms
- All tests pass

---

## v0.3.0 — Provider Abstraction (Planned)

**Target:** Q3 2026 | Duration: 3-4 weeks

**Goals:**
- Support multiple review providers (Codex, Claude 3.5, local models)
- Provider discovery and fallback
- Cost tracking per provider
- Performance metrics per provider

**Proposed Architecture:**

```ts
interface ReviewProvider {
  name: string;
  version: string;
  available(): boolean;
  review(diff: string, prompt: string): Promise<string>; // JSONL output
  supportsEphemeral: boolean;
  costPer1kTokens: number;
}

class CodexProvider implements ReviewProvider { ... }
class ClaudeProvider implements ReviewProvider { ... }
class LocalProvider implements ReviewProvider { ... }

// In codex-runner: delegate to provider
const provider = selectProvider("codex", ["claude", "local"]);
const output = await provider.review(diff, prompt);
```

**Configuration:**
```json
{
  "providers": {
    "preferred": ["claude", "codex", "local"],
    "codex": { "enabled": true, "timeout": 120000 },
    "claude": { "enabled": false, "model": "claude-3-5-sonnet", "apiKey": "sk-..." },
    "local": { "enabled": false, "endpoint": "http://localhost:8000" }
  },
  "fallback": "warn" // "error" | "warn" | "skip"
}
```

**Database Changes:**
```sql
ALTER TABLE reviews ADD COLUMN provider TEXT DEFAULT 'codex';
```

**New MCP Tools:**
```ts
bridge_provider_status() → {
  active: string,
  available: string[],
  cost_today: number,
  tokens_used: number
}

bridge_set_provider(name: string) → { success, message }
```

**Implementation Plan:**
1. Define ReviewProvider interface
2. Implement CodexProvider (refactor existing)
3. Implement ClaudeProvider (use Anthropic SDK)
4. Implement LocalProvider (HTTP client)
5. Add provider registry + discovery
6. Add provider metrics table to DB
7. Update docs with provider guide
8. Tests for provider switching + fallback

**Success Criteria:**
- Codex provider works as before
- Claude provider produces valid findings
- Fallback to codex if claude unavailable
- Provider metrics tracked in DB
- Zero breaking changes to existing tools

---

## v0.4.0 — Dashboard & Analytics (Planned)

**Target:** Q3-Q4 2026 | Duration: 4-6 weeks

**Goals:**
- Web dashboard for finding trends
- Review metrics (time, findings per review, resolution rate)
- Finding heat map (most-flagged files, patterns)
- Export reports (CSV, JSON)

**Architecture:**
```
┌─────────────────────────────────────┐
│       Web Dashboard (Vue/React)      │
│  - Finding trends chart              │
│  - Resolution timeline               │
│  - File heat map                     │
│  - Export to CSV/JSON                │
└────────────────────┬────────────────┘
                     │ HTTP
          ┌──────────▼──────────┐
          │  Dashboard API      │
          │  (Express/Hono)     │
          │  - GET /findings    │
          │  - GET /metrics     │
          │  - GET /heatmap     │
          │  - POST /export     │
          └──────────┬──────────┘
                     │
          ┌──────────▼──────────┐
          │   SQLite Database   │
          │   (existing)        │
          └─────────────────────┘
```

**Views:**
1. **Recent Findings** — Last 20 findings, filterable by severity
2. **Trends** — Findings over time (daily/weekly)
3. **File Heat Map** — Files with most critical findings
4. **Resolution Rate** — % of findings resolved per reviewer
5. **Provider Stats** — Codex vs Claude vs Local findings comparison
6. **Export** — Download CSV/JSON snapshot

**Database Enhancements:**
```sql
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY,
  date TEXT,
  total_reviews INTEGER,
  total_findings INTEGER,
  critical_findings INTEGER,
  resolution_rate REAL,
  avg_resolution_time_seconds INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Implementation Plan:**
1. Design dashboard wireframes
2. Build Express server with SQLite queries
3. Implement Vue.js dashboard
4. Add metrics aggregation queries
5. Add CSV/JSON export endpoints
6. Add Docker compose for easy deployment
7. Write deployment guide

**Success Criteria:**
- Dashboard loads findings within 1s
- Trends chart shows >3 months of data
- Export completes <5s for 1000 findings
- No performance regression on MCP tools
- Mobile responsive

---

## v0.5.0 — Git & PR Integration (Planned)

**Target:** Q4 2026 | Duration: 3-4 weeks

**Goals:**
- GitHub/GitLab PR comment integration
- Finding linking to code ranges (blame annotation)
- Commit history correlation
- Merge queue blocking

**Features:**

### F1: PR Comments
```ts
// New MCP tool
bridge_post_pr_findings({
  pr_number: number,
  provider: "github" | "gitlab",
  token: string
}) → { posted_count, pr_url }
```

**GitHub Comment Format:**
```markdown
## Codex Review — 3 Finding(s)

### Critical (1)
- [CRITICAL] SQL injection — `src/db.ts:42`
  ```diff
  - query = "SELECT * FROM users WHERE id = " + id
  + query = db.prepare("SELECT * FROM users WHERE id = ?").get(id)
  ```

### Warning (2)
- [WARNING] Missing null check — `src/api.ts:15`
- [WARNING] Unused variable — `src/utils.ts:8`
```

### F2: Blame Annotation
```ts
// Correlate findings to commits
interface FindingWithCommit {
  finding: Finding;
  commit_sha: string;
  commit_author: string;
  commit_date: string;
}
```

### F3: Merge Queue Blocking
```bash
# In GitHub Actions / GitLab CI
codex-review-check:
  script:
    - node dist/cli.js check-unresolved --block
    - echo "No critical findings — ready to merge"
```

**Implementation Plan:**
1. Add GitHub/GitLab SDK integration
2. Implement PR comment formatter
3. Add finding ↔ commit correlation
4. Add CI/CD workflow examples
5. Update docs with setup guide
6. Add integration tests for PR posting

**Success Criteria:**
- Comments post to GitHub PR within 30s
- Comments readable and actionable
- CI check blocks on critical findings
- Blame annotation shows commit context

---

## v1.0.0 — Production Ready (Planned)

**Target:** Q4 2026-Q1 2027 | Duration: 2-4 weeks

**Goals:**
- Stability & reliability hardening
- Performance optimization
- Comprehensive observability
- SLA: 99.5% availability, <120s review latency

**Requirements:**
- ✅ All v0.2–0.5 features complete
- ✅ 95%+ test coverage
- ✅ Zero known security vulnerabilities
- ✅ Performance benchmarks documented
- ✅ 10+ successful customer deployments
- ✅ Production deployment guide
- ✅ On-call runbook for outages

**Stability:**
- Circuit breaker for Codex timeouts
- Graceful degradation (skip review if Codex down)
- Database corruption detection + repair
- Automated backup of findings

**Observability:**
- Prometheus metrics export
- Structured logging (JSON)
- Distributed tracing (OpenTelemetry)
- Health check endpoint

**Documentation:**
- Architecture decision records (ADRs)
- Deployment runbook
- Troubleshooting guide
- API specification (OpenAPI)

---

## Beyond v1.0.0 — Long-term Vision

### Emerging Opportunities (18+ months)

1. **AI Model Fine-Tuning**
   - Fine-tune Codex/Claude on team's codebase
   - Custom severity levels per team
   - Learning from resolved findings

2. **Team Collaboration**
   - Comment threads on findings
   - Suggestion acceptance/rejection tracking
   - Finding ownership assignment

3. **IDE Integration**
   - VSCode extension
   - JetBrains plugin
   - Real-time inline findings

4. **Governance & Compliance**
   - Finding audit log (immutable)
   - SLA tracking (e.g., critical findings resolved within 24h)
   - Compliance reports

5. **Advanced Deduplication**
   - Finding similarity matching
   - Pattern recognition (repeated issues)
   - Preventive recommendations

---

## Current Release Schedule

| Version | Target | Status | Risk |
|---------|--------|--------|------|
| v0.1.0 | 2026-03-26 | COMPLETE | ✅ |
| v0.2.0 | 2026-Q2 | PLANNED | Medium |
| v0.3.0 | 2026-Q3 | PLANNED | Medium |
| v0.4.0 | 2026-Q3-Q4 | PLANNED | Medium |
| v0.5.0 | 2026-Q4 | PLANNED | High |
| v1.0.0 | 2027-Q1 | PLANNED | Medium |

---

## Dependency Roadmap

### Current (v0.1.0)
- Node.js >=20
- TypeScript 6.0.2
- @modelcontextprotocol/sdk ^1.28.0
- better-sqlite3 ^12.8.0

### v0.2.0 (no new deps)
- Maybe: `zod` (for config validation, currently transitive)

### v0.3.0
- `@anthropic-ai/sdk` (Claude provider)
- `axios` (local model HTTP client)

### v0.4.0
- `express` (dashboard API)
- `vue` or `react` (dashboard UI)
- `chart.js` or `recharts` (charts)

### v0.5.0
- `@octokit/rest` (GitHub API)
- `@gitbeaker/rest` (GitLab API)

### v1.0.0
- `prom-client` (Prometheus metrics)
- `winston` or `pino` (structured logging)
- `opentelemetry/*` (tracing)

---

## Success Metrics & KPIs

### Adoption
- [ ] 10+ developers using in daily workflow
- [ ] 50+ peer reviews per month
- [ ] 80%+ of findings resolved (not rejected)

### Quality
- [ ] <5% false positive findings
- [ ] 95%+ of critical findings lead to code changes
- [ ] Review latency <120s (99th percentile)

### Reliability
- [ ] 99.5% uptime (MCP server)
- [ ] Zero data loss incidents
- [ ] Zero security vulnerabilities (known)

### User Satisfaction
- [ ] NPS >50
- [ ] <2 support tickets per month
- [ ] >90% of users continue after 30 days

---

## Decision Log

### Decision 1: Single-Queue Execution (v0.1.0)
**Question:** Parallel or sequential reviews?

**Decision:** Single-queue, newer requests supersede queued.

**Rationale:** Simpler implementation, matches development workflow (one user edits at a time), prevents review spam, easier debugging.

**Trade-off:** Can't parallelize reviews from multiple Claude instances, but acceptable for v0.1.0.

---

### Decision 2: SQLite Instead of PostgreSQL (v0.1.0)
**Question:** Embedded or remote database?

**Decision:** SQLite (embedded) for v0.1.0, PostgreSQL optional in v0.3.0+.

**Rationale:** Zero DevOps overhead, works on developer laptop, no network latency, WAL mode supports concurrent reads.

**Trade-off:** Not suitable for team-shared dashboards yet (planned in v0.4.0 with API layer).

---

### Decision 3: Codex-Only in v0.1.0 (v0.1.0)
**Question:** Multi-provider support from day 1?

**Decision:** Codex-only, abstraction in v0.3.0.

**Rationale:** Faster v0.1.0 release, proven integration, avoid over-engineering. Provider interface designed in v0.3.0 planning.

**Trade-off:** Early adopters locked into Codex (but can --no-verify bypass).

---

## Open Questions

1. **Performance at Scale:** How many findings/reviews before SQLite bottlenecks?
   - Mitigation: Add PostgreSQL support in v0.3.0 if needed
   - Timeline: Investigate after 6+ months of usage data

2. **Finding Deduplication:** How to detect similar findings across reviews?
   - Mitigation: Simple text similarity in v0.2.0, ML-based in v1.0.0+
   - Timeline: Q3 2026

3. **Team Sharing:** What's the UX for multi-developer teams?
   - Mitigation: Dashboard API in v0.4.0, PRs in v0.5.0
   - Timeline: Q3-Q4 2026

4. **Codex Cost:** How to optimize Codex spend for large codebases?
   - Mitigation: Provider abstraction in v0.3.0, fine-tuning in v2.0.0
   - Timeline: Q3 2026+

---

## Backlog (Not Prioritized)

- [ ] Incremental reviews (only changed files, not full diff)
- [ ] Finding dedup across reviews
- [ ] Custom finding severity levels per team
- [ ] SBOM (Software Bill of Materials) generation
- [ ] SAST (Static Application Security Testing) integration
- [ ] Jira/Linear integration
- [ ] Mobile app (optional)
