# Changelog

All notable changes to Project Knowledge Hub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

* Milestone execution order: M8–M10 feature work preceded **M7** Dokploy packaging. M7 is staged as Dokploy Dev/UAT, then Prod after testing (`MILESTONE_TRACKING.md`, `ROADMAP.md`).
* Docs: ChatGPT Custom GPT Actions setup (verified read + write against public OpenAPI) in `MCP_CURSOR_SETUP.md`.
* Web middleware: allow unauthenticated `/mcp` through to the API rewrite (fixes MCP `initialize` EOF when clients hit `{WEB_URL}/mcp`).
* Web middleware: return JSON 404 for `/.well-known/*` so MCP OAuth discovery does not receive the login HTML page.

### Added

* Backlog **NF-002**: Dokploy Compose one-shot bootstrap admin seed after migrate (`NEXT_FEATURES.md`, `DOKPLOY.md` follow-ups).
* Milestone 7 Dokploy Dev/UAT packaging (first slice): fixed api/web/worker Dockerfiles for the current monorepo, `compose.dokploy.yaml` (private pgvector Postgres/Redis, migrate one-shot, volumes), migrate/seed/backup/restore scripts, and operator runbook (`docs/deployment/DOKPLOY.md`). Prod cutover deferred.
* Milestone 10 semantic/hybrid search (first slice): `pgvector` Postgres image, migration `0020`, `@project-knowledge-hub/embeddings` (disabled/ollama/openai_compatible), embedding reindex worker queue, search `mode=hybrid` + capabilities API, UI checkbox and MCP `mode`. Default remains FTS-only (`EMBEDDING_PROVIDER=disabled`).
* Milestone 9 conversation import (first slice): paste text/Markdown into workspace-scoped `conversation_imports`, create one or more draft knowledge records with conversation provenance, keep raw pastes out of MCP/search. API under `/api/v1/conversation-imports`, workspace Imports UI, package `@project-knowledge-hub/conversation-import`, migration `0019`.
* Locale-aware branded product emails (`packages/mail`): shared HTML layout (IN3 / Project Knowledge Hub), en/de/hu catalogs, and `users.preferred_locale` (synced from language switcher, login, and register). Covers password reset, invite, email confirm, account approved, password changed, account closed, signup rejected, and AI connection pending/approved/rejected. Optional alerts are user-toggleable under Account → Email notifications (`users.email_notification_prefs`).
* Admin user remove (`DELETE /api/v1/users/:userId`) soft-closes accounts for audit. In **development/test** only, `?hard=1` permanently purges the user and authored knowledge/git connections (`user.purge`). Production/staging keep soft-close.
* AI MCP autodiscover: public `/ai-discover` + `GET /api/v1/ai-discover`, user pairing codes, pending API client requests (`POST /api/v1/ai-discover/requests` + claim poll). User or system admin can approve/reject; token issued once for the agent. Profile → Connect AI and Admin → API clients pending section.
* Admin user remove (`DELETE /api/v1/users/:userId`) and self-service account close (`DELETE /api/v1/me` with `confirmPhrase: "CLOSE"`): soft-close (sessions revoked, credentials cleared, email freed); last system admin protected. Admin Users list has search/status filter via `FunctionHeader`; profile Close account uses double confirmation.
* Status page polish: Admin sidebar entry (removed from header), back link beside eyebrow, colored health badges; workspace tiles drop left accent bars and keep hover wash.
* Auth login: eyebrow brand **IN3 Technology**, product title Project Knowledge Hub, Registration with email confirmation then admin approval (`pending_email` → `pending_approval` → `active` + workspace memberships), password show/hide, and strength meter (safe = 8+ chars, uppercase, number/symbol).
* User profile: `full_name` plus IdP stub columns (`idp_source`, `idp_subject`), optional avatar upload (JPEG/PNG/WebP) with monogram fallback, self-service `/account/profile` (`GET/PATCH /api/v1/me`, avatar POST/DELETE), header avatar + profile link, and admin create/edit for full name / IdP stub.
* Admin → Email settings: SMTP / Resend / console configuration stored in `platform_settings` (overrides `.env`), test-send, and sidebar nav entry.
* Email, invites, and forgotten password: pluggable mail package (`console` / `smtp` / `resend`), `auth_tokens` table, forgot/set-password APIs and pages, admin invite-without-password + resend invite, and admin user edit (display name / password / status).
* Multi-provider git sync backends: shared `GitSyncProvider` interface + adapters for GitHub, GitLab, Azure DevOps, Bitbucket, and Forgejo (PAT auth; optional/required `baseUrl` for self-hosted). Sync, health, create/update API, and per-provider webhook routes (`/api/v1/git/webhooks/{provider}`). Migration `0011_git_connection_base_url`.
* Synchronizations hub UI: multi-connection list with provider, status, last sync, Manage, and Add (provider catalog). All catalog providers are creatable with per-provider field labels and base URL where needed.
* Workspace header: status badge (Active / Archived / Needs attention — attention links to Git sync) plus a Manage modal for details/statistics (editable brief description ≤280 chars, ID, owners, dates, counts), synchronizations, archived items, color, and archive/restore. Description overview appears above the accent bar on the workspace page.
* Workspace accent colors: optional curated palette on workspaces (API `color`, migration `0010_workspace_color`), colored tiles on dashboard/list/detail, and create/edit color picker for workspace admins. Unset colors still resolve to a stable hash accent.
* Milestone 8: GitHub repository connections, Markdown sync into `git_managed` knowledge records, path→type mappings, sync history, BullMQ worker queue, GitHub webhooks, sync-health badges, and workspace **Git sync** UI. Hub edits to git-managed records are blocked. Worker runs a daily safety re-sync (`GIT_SYNC_SAFETY_INTERVAL_MS`, default 24h).
* MCP/OpenAPI `list_record_metadata` discovery tool: required/optional create fields, record-type catalog with descriptions, lifecycle and source-of-truth enums, and MCP write constraints. OpenAPI `recordType` now uses the shared enum.
* Knowledge ledger record types: `business-idea`, `vision`, `plan`, `initiative`, and `note` (plus UI type labels in en/de/hu).
* Audit log PDF export (`format=pdf` on `GET /api/v1/audit-events/export`): Admin Audit menu download with per-page header/footer covering organization, project (when resolvable), filter details, date/timestamp, and page numbers.
* Soft-archive management UI: archive/restore on workspaces, projects, systems, and knowledge records; header Archive → `/archived` user restore hub; workspace Archived items page; Admin → Archive overview. Lists/search still hide archived by default (`includeArchived` on workspace list).
* ADR-014: elevated API client capabilities — tiered scopes (`catalogue:write` next), propose/confirm commit protocol, and deferred workspace/org/archive tiers for trusted LLM automation.
* Design-system feedback layer: toast primitives/recipes/tokens, newest-first admin lists, and a required Changelog in `docs/design/DESIGN_SYSTEM.md` for UI adjustments.
* Admin Organizations page (`/admin/organizations`) to create, edit, and delete organizations (name/slug), with `POST`/`PATCH`/`DELETE /api/v1/organizations`. Delete can transfer workspaces, tags, and API clients to another organization (auto-selected when only one remains).
* LLM setup wizard client schemas for Cursor, ChatGPT (OpenAPI Actions), Gemini (MCP + OpenAPI + functionDeclarations), Microsoft Copilot Studio (Swagger 2.0 MCP streamable), and OpenWebUI (MCP or OpenAPI), plus Bearer-authenticated OpenAPI tool facade at `/api/v1/llm/*`.
* Centralized web design system: `tokens.css` (`--kh-*`), shared CSS recipes (`.kh-btn*`, panels, nav, steps, pagination), and UI primitives (`LinkButton`, `NavLink`, `Panel` variants) so theme changes propagate site-wide. See `docs/design/DESIGN_SYSTEM.md`.
* Admin LLM/MCP setup wizard (`/admin/mcp-setup`): platform checks, client creation, connection tests, and Cursor config copy.
* Optional public MCP URL override for proxies/split DNS (`MCP_PUBLIC_URL` env and admin-saved platform setting).
* Light/dark theme preference with cookie persistence, FOUC-safe boot script, and sun/moon header toggle.
* Platform admin UI (`/admin`) for system administrators: overview, users, memberships, API clients, and audit log.
* Audit log browsing: full-text search, action/entity/actor filters, date range and calendar day view, pagination, and expandable metadata.
* Audit log export: CSV/JSON/PDF download of the current filtered result set (max 10,000 rows), with export actions themselves audited.
* Admin APIs: organizations list, users CRUD (admin), memberships CRUD, audit events list (search, date filters, pagination, day counts).
* Tailwind CSS UI system for the web app: design tokens, shared primitives (Button, Panel, Field, Badge, Page), modernized shell and pages.
* Draft-only write-capable MCP: `knowledge:write` scope, `create_knowledge_record` / `update_knowledge_record`, API client `actingUserId`, ADR-013.
* UI internationalization (English, German, Hungarian) via `next-intl`, cookie locale, and language switcher.
* Milestone 6 read-only MCP: API clients, Streamable HTTP `/mcp`, scopes, rate/size limits, Cursor setup.
* Milestone 5 search: PostgreSQL FTS index, filtered search API, snippets, `/search` UI.
* Milestone 4 versioning and lifecycle: immutable versions, history/restore, verify, mark-current with supersede.
* Milestone 3 knowledge records: CRUD, provenance, safe Markdown (sanitize/TOC/highlight/Mermaid), document UI.
* Milestone 2 project and system catalogue (CRUD, tags, archive, UI, permission tests).
* API `GET /` discovery document (replaces bare 404 on API root).
* Milestone 1 identity and workspace foundation.
* Session cookies, bootstrap administrator seed, workspace CRUD, audit events.
* Auth and permissions packages (`scrypt` password hashing, role checks).
* Web login, application shell, protected routes, and workspace UI.
* API routes under `/api/v1` for auth and workspaces.
* Next.js rewrite proxy for `/api/v1/*` to keep cookies same-origin.

### Added (Milestone 0)

* Milestone 0 repository and platform foundation.
* pnpm workspaces and Turborepo monorepo layout.
* `apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (Node.js).
* Shared packages: `config`, `database`, `domain`, `observability`.
* README-only stubs for deferred packages.
* PostgreSQL and Redis Docker Compose services (`knowledge-hub-dev`).
* Drizzle ORM schema foundations for organization, workspace, user, membership, project, and system.
* API `GET /health` and `GET /ready` endpoints.
* Web status page (application name, web/API status, environment).
* Worker Redis connectivity with structured readiness logging and graceful shutdown.
* Vitest unit and API integration tests.
* GitHub Actions CI (install, lint, typecheck, test, build).
* Product, architecture, development, deployment, security documentation and ADRs 001–012.
* Tracking documents: `docs/CHANGELOG.md`, `docs/MILESTONE_TRACKING.md`, `docs/MILESTONE_0_IMPLEMENTATION_PLAN.md`.

## [0.1.0] - TBD

* First tagged release after Milestone 0 validation and packaging (Milestone 7).
