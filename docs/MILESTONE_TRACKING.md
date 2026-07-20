# Milestone Tracking

**Product:** Project Knowledge Hub  
**Repository:** `project-knowledge-hub`  
**Last updated:** 2026-07-20

This document tracks milestone progress against the PRD. Update status as work completes. Do not mark a milestone complete while lint, typecheck, tests, build, or Docker validation fail.

---

## Status legend

| Status | Meaning |
| --- | --- |
| `not_started` | Work has not begun |
| `in_progress` | Active implementation |
| `blocked` | Waiting on dependency or decision |
| `complete` | All completion criteria verified |
| `deferred` | Explicitly postponed |

---

## Execution order (decision 2026-07-19)

Milestone **IDs** stay as in the PRD (M0–M10). **Build order after the localhost MVP** is:

1. Keep **localhost / Compose dev** solid (`docs/development/LOCAL_DEVELOPMENT.md`) — primary environment for feature work.
2. **M8** — GitHub synchronization (git-managed docs into projects) — **complete**.
3. **M9** — Conversation import (first slice complete; optional automations later).
4. **M10** — Semantic / hybrid search (first slice; optional, before packaging).
5. **M7** — Production packaging and Dokploy, staged as:
   - Dokploy **Dev/UAT** first
   - **Prod** only after testing (HTTPS, MCP, persistence, backup/restore)

M7 is **`deferred`**: it does not block M8/M9. Dokploy is the last packaging step, not the next feature gate.

---

## Milestone overview

| ID | Name | Status | Notes |
| --- | --- | --- | --- |
| M0 | Repository and platform foundation | `complete` | Validated 2026-07-19 |
| M1 | Identity and workspace foundation | `complete` | Validated 2026-07-19 |
| M2 | Project and system catalogue | `complete` | Validated 2026-07-19 |
| M3 | Knowledge records | `complete` | Validated 2026-07-19 |
| M4 | Versioning and lifecycle | `complete` | Validated 2026-07-19 |
| M5 | Search | `complete` | Validated 2026-07-19 |
| M6 | MCP (read + draft write) | `complete` | Validated 2026-07-19 |
| M7 | Production packaging and Dokploy | `deferred` | After M8 (and preferably M9); Dev/UAT then Prod |
| M8 | GitHub synchronization | `complete` | Validated 2026-07-19 — see checklist below |
| M9 | Conversation import | `complete` | First slice validated 2026-07-20 — see checklist below |
| M10 | Semantic and hybrid search | `complete` | First slice on `feature/m10-semantic-search` — see checklist below |

### Next features (not PRD milestones)

See `docs/product/NEXT_FEATURES.md`. Doc Factory (NF-001) is **parked** pending a precise module brief; early notes in `docs/product/DOC_FACTORY.md`. Does not displace M9.

---

## Milestone 10 checklist

- [x] Postgres image with pgvector (`pgvector/pgvector:pg16`) in Compose + CI
- [x] Migration `0020` — extension, embedding models, chunks + HNSW
- [x] `@project-knowledge-hub/embeddings` (disabled / ollama / openai_compatible)
- [x] Env config + `.env.example`
- [x] `embedding-reindex` BullMQ queue + worker
- [x] Enqueue on knowledge write + workspace reindex API
- [x] Hybrid search mode + capabilities endpoint + UI/MCP
- [x] Docs (implementation plan, tracking, changelog)
- [ ] Later: admin embedding settings UI, multi-model migration wizard (deferred)

## Milestone 9 checklist

- [x] `conversation_imports` + `conversation_import_records` (migration `0019`)
- [x] Package `@project-knowledge-hub/conversation-import` (schemas/helpers)
- [x] API create/list/get/archive + create draft from import
- [x] Draft provenance (`conversation` / `imported_snapshot` / sourceReference = import id)
- [x] Raw imports excluded from MCP/search (separate table)
- [x] Workspace Imports UI (list / new / detail + create draft) + i18n en/de/hu
- [x] Integration + package unit tests
- [ ] Later: ChatGPT / Open WebUI / JSON importers, auto-split, secret detection (deferred)

## Milestone 8 checklist

- [x] Git-provider interface + GitHub tree/blob fetch
- [x] Repository connections (workspace, optional project, branch, include/exclude)
- [x] Default path → recordType mappings (ADR, deployment, product, …)
- [x] Initial sync + incremental skip on unchanged blob SHA
- [x] Deleted paths soft-archived (leave default search)
- [x] Sync job queue (BullMQ) + worker consumer
- [x] GitHub webhook with HMAC secret (`POST /api/v1/git/webhooks/github`)
- [x] Sync history (`git_sync_runs`)
- [x] Git-managed UI + API edit lock; source URL/commit visible
- [x] `pnpm` typecheck / unit tests for connectors; API tests green
- [x] Synchronizations hub UI (multi-connection list, Add provider catalog, Manage); non-GitHub providers catalogued as coming soon
- [x] Multi-provider sync backends (GitLab, Azure DevOps, Bitbucket, Forgejo) + `baseUrl` + per-provider webhooks

## Milestone 6 checklist

- [x] API clients + hashed bearer tokens
- [x] MCP Streamable HTTP endpoint (`/mcp`)
- [x] Read-only discovery/search/retrieval/provenance tools
- [x] Draft-only write tools (`knowledge:write`, `actingUserId`, workspace allowlist)
- [x] Scopes, rate limit, response size limits
- [x] MCP audit logging + Cursor config example
- [x] Integration tests
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 5 checklist

- [x] PostgreSQL full-text index (`search_vector` + GIN)
- [x] Search API with filters and authz
- [x] Search UI with snippets
- [x] Default exclusion of deprecated/superseded/archived
- [x] Ranking: title + current/verified above drafts
- [x] Relevance + permission tests
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 4 checklist

- [x] Immutable version records on content update
- [x] Version history API + UI
- [x] Change message + restore (new version)
- [x] Verify + mark-current operations
- [x] Automatic superseding of previous current in series
- [x] Historical / superseded status warnings
- [x] Permission + versioning tests
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 3 checklist

- [x] Knowledge-record CRUD API + UI
- [x] Record types, lifecycle statuses, source-of-truth modes
- [x] Project/system association + provenance fields
- [x] Safe Markdown preview (sanitize, no script execution)
- [x] Document page with TOC, code highlighting, Mermaid
- [x] Audit events
- [x] Permission + sanitization tests
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 2 checklist

- [x] Project CRUD API + UI
- [x] System CRUD API + UI (optional project association)
- [x] Tags + archive behaviour
- [x] Slug uniqueness within workspace
- [x] Permission tests (reader cannot mutate; archived excluded by default)
- [x] API `GET /` discovery document
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 1 checklist

- [x] Bootstrap administrator seed
- [x] Login / logout / session endpoints
- [x] HTTP-only session cookies with TTL
- [x] Role authorization helpers
- [x] Organization seed
- [x] Workspace CRUD API
- [x] Application shell + protected routes
- [x] Audit events for auth and workspace changes
- [x] Integration tests (admin create, reader forbidden, logout expires session)
- [x] `pnpm lint` / `typecheck` / `test` / `build`

---

## Milestone 0 checklist

See historical completion in git history / `docs/MILESTONE_0_IMPLEMENTATION_PLAN.md`. Marked `complete`.
