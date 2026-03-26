# claude-peer-pressure Documentation

Complete documentation for the claude-peer-pressure MCP server project.

## Quick Navigation

**New to this project?** Start here:
- **[README.md](../README.md)** — What it does, quick start, architecture overview
- **[Project Overview & PDR](./project-overview-pdr.md)** — Goals, requirements, acceptance criteria

**Want to understand the code?**
- **[Codebase Summary](./codebase-summary.md)** — Module walkthrough, data flow, design patterns
- **[Code Standards](./code-standards.md)** — Conventions, error handling, security guidelines

**Architecting or troubleshooting?**
- **[System Architecture](./system-architecture.md)** — Components, data flow sequences, state management
- **[Project Roadmap](./project-roadmap.md)** — v0.1.0 status, v0.2.0-v1.0.0 plans

---

## File Descriptions

### [README.md](../README.md) (279 lines)
**Purpose:** Project onboarding and quick reference

**Contains:**
- What it does + why it exists
- Quick start (build, run, test)
- Architecture overview (diagram)
- MCP tools reference (4 tools, parameters, examples)
- CLI reference
- Database schema
- Hook integration guide
- Design decisions
- File structure
- Code standards summary
- Development guidelines

**Best for:** New developers, first-time users, API consumers

---

### [project-overview-pdr.md](./project-overview-pdr.md) (170 lines)
**Purpose:** Product Development Requirements document

**Contains:**
- Problem statement + target users
- 5 core goals + non-goals
- 5 functional requirements (F1-F5)
- 4 non-functional requirements (NFR1-NFR4)
- Technical constraints
- Acceptance criteria (7 items)
- Success metrics (5 measurable)
- v0.1.0 status
- Dependencies table
- 7 risks with mitigations
- 5 known limitations
- Future enhancements
- Approval checklist

**Best for:** Project managers, stakeholders, requirement tracing

---

### [codebase-summary.md](./codebase-summary.md) (349 lines)
**Purpose:** Implementation overview and module walkthrough

**Contains:**
- Module overview table (5 source files + tests)
- Data flow sequence (13 steps)
- 5 module sections with exports, responsibility, dependencies:
  - mcp-server.ts (4 tools, shutdown)
  - codex-runner.ts (queue, parser, spawning)
  - database.ts (singleton, schema, CRUD)
  - cli.ts (2 commands)
  - diff-hasher.ts (SHA-256 hashing)
- Database schema (SQL)
- Hook integration details
- 4 design patterns with code examples
- Testing approach (node:assert)
- Build & runtime environment
- Dependency versions
- File size & modularity analysis
- Error handling strategy

**Best for:** Code reviewers, architects, developers implementing features

---

### [code-standards.md](./code-standards.md) (562 lines)
**Purpose:** Coding conventions and practices

**Contains:**
- Language & tooling (TypeScript, ESM, Node.js >=20)
- File organization (naming, directory structure)
- TypeScript standards (strict mode, imports, types)
- Comments & documentation (JSDoc, inline)
- Database standards (SQL, transactions)
- Testing standards (custom runner, integration focus)
- Error codes & exit codes
- Security standards (validation, parameterized queries, data handling)
- Performance standards (timeouts, buffers, indexes)
- Logging & debugging
- Build & deployment
- Code review checklist (12 items)
- Linting & formatting
- Patterns to avoid

**Best for:** Contributors, code reviewers, new developers

---

### [system-architecture.md](./system-architecture.md) (579 lines)
**Purpose:** Deep architectural documentation

**Contains:**
- Overview architecture diagram
- 5 component architectures (MCP, runner, database, hasher, CLI)
- 4 data flow sequences (user scenarios)
- Error handling strategy (8 scenarios)
- State management (runtime + database)
- Concurrency & synchronization
- Scalability & performance (targets, limits)
- Security considerations (threat model, trust boundaries)
- Deployment topology (v0.1.0 single, v2.0.0+ multi)
- Integration points (hooks, git, CLI)
- Technology stack
- Design patterns used
- Future architectural improvements

**Best for:** Architects, senior developers, system designers

---

### [project-roadmap.md](./project-roadmap.md) (541 lines)
**Purpose:** Product vision and development plan

**Contains:**
- v0.1.0 (COMPLETE, 2026-03-26)
- v0.2.0 (PLANNED, Q2 2026) — Custom prompts, categories, batch resolution
- v0.3.0 (PLANNED, Q3 2026) — Provider abstraction (Codex, Claude, local)
- v0.4.0 (PLANNED, Q3-Q4 2026) — Web dashboard, analytics
- v0.5.0 (PLANNED, Q4 2026) — GitHub/GitLab PR integration
- v1.0.0 (PLANNED, Q1 2027) — Production hardening, observability
- Long-term vision (18+ months)
- Release schedule
- Dependency roadmap
- Success metrics & KPIs
- 3 decision logs
- 4 open questions with mitigations
- Unprioritized backlog

**Best for:** Project managers, product leads, long-term planning

---

## By Role

### Frontend Developer / Claude Code User
1. [README.md](../README.md) — Understand what it does
2. [System Architecture](./system-architecture.md) — See how it works
3. [Code Standards](./code-standards.md) — Follow conventions

### Backend Developer / MCP Contributor
1. [README.md](../README.md) — Quick start
2. [Codebase Summary](./codebase-summary.md) — Understand modules
3. [Code Standards](./code-standards.md) — Coding rules
4. [System Architecture](./system-architecture.md) — Deep dive

### Code Reviewer
1. [Code Standards](./code-standards.md) — What to check
2. [Codebase Summary](./codebase-summary.md) — Module responsibilities
3. [System Architecture](./system-architecture.md) — Design expectations

### Project Manager / Tech Lead
1. [Project Overview & PDR](./project-overview-pdr.md) — Requirements + goals
2. [Project Roadmap](./project-roadmap.md) — Timeline + milestones
3. [README.md](../README.md) — Elevator pitch

### Architect / Technical Decision Maker
1. [System Architecture](./system-architecture.md) — Design + decisions
2. [Project Roadmap](./project-roadmap.md) — Future scalability
3. [Project Overview & PDR](./project-overview-pdr.md) — Constraints

---

## Search Guide

| Topic | Find In |
|-------|----------|
| **What does this do?** | README.md |
| **How do I set it up?** | README.md → Quick Start |
| **What are the goals?** | project-overview-pdr.md |
| **How does it work?** | system-architecture.md |
| **Show me the code** | codebase-summary.md |
| **What are the rules?** | code-standards.md |
| **What's the plan?** | project-roadmap.md |
| **Database schema** | README.md or codebase-summary.md |
| **MCP tools** | README.md |
| **CLI commands** | README.md |
| **Git hooks** | README.md or system-architecture.md |
| **Error handling** | code-standards.md or system-architecture.md |
| **Security** | code-standards.md or system-architecture.md |
| **Performance** | code-standards.md or system-architecture.md |
| **Testing** | codebase-summary.md or code-standards.md |
| **Version history** | project-roadmap.md |
| **Future features** | project-roadmap.md |

---

## Documentation Statistics

| File | LOC | Focus |
|------|-----|-------|
| README.md | 279 | Onboarding + Quick Reference |
| project-overview-pdr.md | 170 | Requirements + Goals |
| codebase-summary.md | 349 | Implementation Overview |
| code-standards.md | 562 | Conventions + Standards |
| system-architecture.md | 579 | Design + Architecture |
| project-roadmap.md | 541 | Vision + Planning |
| **Total** | **2,480** | **Complete Coverage** |

**All files:** Under 800 LOC limit ✅
**All verified:** Against source code ✅
**All linked:** Cross-referenced web ✅

---

## Maintenance Schedule

### After Each Release
- [ ] Update version in project-roadmap.md
- [ ] Note new features in codebase-summary.md
- [ ] Update code-standards.md if conventions change
- [ ] Refresh system-architecture.md if major changes

### Quarterly (Every 3 Months)
- [ ] Review project-roadmap.md for accuracy
- [ ] Update success metrics in project-overview-pdr.md
- [ ] Verify all links still work
- [ ] Check for outdated examples

### Annually (Every 12 Months)
- [ ] Full documentation audit
- [ ] Update technology stack versions
- [ ] Refresh roadmap for new year
- [ ] Document lessons learned

---

## Contributing to Documentation

Before editing:
1. Run `npm run build` to ensure code compiles
2. Verify any code examples against actual implementation
3. Keep file size under 800 LOC (split if needed)
4. Use consistent terminology across all files
5. Update related cross-references

When adding new documentation:
1. Link from this README.md
2. Add to appropriate role guide (above)
3. Update search guide table
4. Update statistics section
5. Create in `/Users/tino/code/a2a-coding/docs/` directory

---

## Contact & Support

For documentation issues:
- Report problems via code review
- Submit improvements via pull request
- Ask questions in project discussions
- Create issues for gaps or errors

**Last Updated:** 2026-03-26
**Status:** Complete for v0.1.0

See [project-roadmap.md](./project-roadmap.md) for documentation roadmap beyond v0.1.0.
