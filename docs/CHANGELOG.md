# Changelog

All notable changes to Project Knowledge Hub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* **Project Delivery (NF-018, local):** milestones, tasks, due/target dates, RACI, and hybrid stakeholders (roster + reports-to org chart) under Projects; REST + project page UI; MCP `pm:read` / `pm:write` for live agent participation. Brief [`PROJECT_DELIVERY.md`](product/PROJECT_DELIVERY.md), ADR-015. Branch `feature/project-delivery` — not for Dokploy until local smoke is done.

* **OIDC sign-in (Authentik):** optional OpenID Connect login beside local email/password; operator integration guide; session links IdP subject when configured.

* **AI translation progress (SSE):** Manage → Translate streams stage updates, elapsed time, indeterminate bar, and a collapsible Details log (content deltas only; Hide stays respected). New `POST …/translations/stream`; JSON POST kept for MCP.

* **Document-import OCR progress UI:** worker writes `progressStage` / `progressMessage` / `progressLog` (migration `0031`); import detail polls every 2s with translate-like bar, elapsed, stage labels (en/de/hu), and collapsible Details. No live Vision token stream (MarkItDown `/convert` stays opaque).

* **Dokploy MinIO companion:** `compose.minio.dokploy.yaml` — MinIO + nginx Host gateway for path-style S3 (`s3-dev…`) and console (`s3-console-dev…`) behind Traefik/Dokploy domains (avoids console-on-API-port “incorrectly forwarded”).

* **Admin AI Providers:** register reusable OpenAI-compatible LLM connections and bind them to Translation / Vision OCR (Doc Factory + embeddings reserved). Admin → AI providers; secrets redacted; Test connection; `VISION_LLM_*` remains env fallback. Authenticated `GET /api/v1/llm/capabilities` drives Manage/Import UI gates. Vision OCR convert accepts per-request provider overrides into `kh-markitdown`.

* **AI translation for knowledge siblings:** optional `translateWithAi` on create-translation (Manage checkbox + MCP/REST). Uses resolved Translation LLM (Admin binding or `VISION_LLM_*`). Fills title/summary/body into a draft sibling before insert; EN is never overwritten. MCP/REST also accept manual `title` / `summary` / `contentMarkdown` when AI is off or as override.

* **Knowledge record translations (Phase 2):** Add translation from Manage (clone metadata, new language + slug, shared `translationGroupId`); detail language switcher among siblings; REST `GET|POST /api/v1/knowledge-records/:id/translations`; MCP `list_record_translations` / `create_record_translation` with EN-default agent guidance. Blocks git-managed sources; one language per group; new siblings start as draft hub-managed. Manage can selectively delete translation siblings. Catalogue collapses siblings into one row with language chips.

* **Knowledge record content language (Phase 1):** editor language select (en/de/hu), language on detail / Manage details, catalogue + search language filters, list/search/MCP `language` filter. Schema adds nullable `translation_group_id` for linked translation families.

* **Document / image import (MarkItDown):** Compose service `kh-markitdown`, package `@project-knowledge-hub/document-import`, API `/api/v1/document-imports`, worker convert queue, Import picker Documents + Images lanes. Selectable OCR: `none`, `vision` (`markitdown-ocr` + OpenAI-compatible / Ollama), or local `tesseract`. Extracted images become `workspace_media` embeds. See [`docs/product/DOCUMENT_IMPORT.md`](product/DOCUMENT_IMPORT.md).

* **Admin Storage migrate:** **Migrate local files to S3** copies existing `/data` avatars/media/imports/style-packs into the configured bucket (dual-write remains for new uploads).

* **In-app page refresh:** secondary Refresh control next to Manage on workspace / project / system / knowledge-record / import pages (`ManageToolbar` + `router.refresh()`).

### Fixed

* **Long AI translate via Next:** `experimental.proxyTimeout` raised so Next rewrites no longer return opaque HTTP 500 after ~30s while the API/Ollama call is still running. Traefik/Dokploy gateway timeouts documented in `DOKPLOY.md`.

* **AI translation Markdown/JSON:** harden Vision LLM parse (heading restore, unescape, strip `<think>`); unwrap only whole-response fences so fenced code inside `contentMarkdown` is not mistaken for the JSON wrapper. Fast path thinking-off with one thinking-on retry on echo/bad JSON; Details log clears on retry.

* **Vision OCR GPU hang after abort:** `kh-markitdown` enforces convert `timeoutMs`, injects `think: false` / `max_tokens` for OCR, closes the Ollama HTTP client and best-effort unloads the model when the worker disconnects or the budget expires (prevents stuck GPU after a 5‑minute provider timeout).

* **ChatGPT Actions OpenAPI:** clamp `info.description` and bump schema version so Custom GPT Actions import stays under the 300-character limit / cache clears.

* **Automated backups:** `db-backup` scripts are **baked into** `knowledge-hub-db-backup` (no git-checkout bind mount). Dokploy redeploys were replacing the clone while a long-sleeping sidecar kept a stale mount → overnight `backup-db.sh: No such file or directory`, then 24h sleeps with no heartbeat (“Ütemező offline”).
* **Automated backups:** `db-backup` no longer sleeps a full interval before every dump. Overdue dumps run on catch-up, long waits are interruptible (~1 min polls) so Admin schedule changes apply quickly, failures retry sooner, and Monitoring shows a scheduler heartbeat / next-due. Local `compose.yaml` starts `db-backup` by default (no `--profile backup`).

### Changed

* **Mail Resend driver:** optional `RESEND_BASE_URL` / Admin → Email **API base URL** for Resend-compatible providers (e.g. Freeresend). Empty = `https://api.resend.com`.

* `pnpm db:migrate` loads root `.env` via `loadNearestDotEnv` so `DATABASE_URL` is found when the script runs from `packages/database`.

* Dokploy Monitoring backup **export** / **delete**: shared `knowledge_hub_backups` volume was root-owned by `db-backup` while api/worker run as uid 1001. Entrypoints chown `/backups` on start; sidecar re-chowns after each dump; clearer `BACKUP_PERMISSION_DENIED` errors.
* Dokploy Monitoring **export**: API image used Debian `postgresql-client` 15 against Postgres 16 (`pg_dump` version mismatch). Install `postgresql-client-16` from PGDG; keep local dump if offsite upload fails.
* Live Monitoring **import**: terminate other DB sessions before `pg_restore --clean`, then restart the API process so pools recover (avoids “import OK” then unreachable stack).
* Live Monitoring / `import-db.sh` **import**: wipe `public` (+ `drizzle`) with `DROP SCHEMA … CASCADE` before restore so target-only tables (e.g. `workspace_media`) cannot block `--clean` DROP; fail hard on `cannot drop` / `already exists` restore errors.
* Dokploy **migrate** one-shot: `/migrate-and-seed.sh` (preflight auth, clear hints); disable healthcheck on migrate; after import, baseline `drizzle.__drizzle_migrations` when tables exist without a journal so redeploy is idempotent.
* Monitoring **import/export**: `pg_dump`/`pg_restore`/`psql` use discrete `POSTGRES_PASSWORD` (same as migrate) instead of parsing Compose `DATABASE_URL`, avoiding false `28P01` on passwords with special characters.
* Dokploy **intermittent `28P01`** with an unchanged password: `postgres`, `redis`, `worker`, `migrate` and `db-backup` no longer join the shared external `dokploy-network`. Two apps deploying this stack registered duplicate `postgres`/`redis`/`api` DNS aliases there, so migrate/api could resolve another app's database (and Redis) and be rejected by its password.
* Dokploy Compose renames DB/Redis services to **`kh-postgres`** / **`kh-redis`**. `api` stays on `dokploy-network` for Traefik, so a generic `postgres` hostname still resolved *other* apps on that network (e.g. `amae-postgres`) — migrate (project network only) succeeded while login failed with `28P01`.
* Monitoring **import** journal baseline: resolve drizzle SQL under `src/migrations` when the API loads compiled `dist/` code (fixes `ENOENT …/dist/migrations/meta/_journal.json`). Journal repair failures no longer report the restore as failed after data was already replaced.
* Live Monitoring / `import-db.sh` **import** no longer wipes first and fails second: preflight checks restore tooling, dump readability (`pg_restore --list`) and credentials (`SELECT 1`) before any `DROP SCHEMA`, so a `28P01` or truncated upload leaves the database unchanged instead of empty.
* Stale session cookie after DB import caused `/login` ↔ `/dashboard` redirect loop (middleware treated cookie presence as logged-in). Login no longer auto-bounces on cookie alone; `GET /auth/session` returns `{ user: null }` when unauthenticated.

### Changed

* Docs layout: milestone plans → `docs/milestones/`; MCP Cursor setup → `docs/development/`; added `docs/README.md` index; root PRD paste redirects to `docs/product/PRD.md`.
* Knowledge markdown viewer: collapsible TOC with section jumps that match sanitized heading ids; summary / links / source metadata collapsed behind **More details** (also in Manage → Details); record edit opens in ~90% Modal `xl`.
* Project detail: list linked knowledge records (via `projectId`) alongside linked systems.
* Docs: ChatGPT Custom GPT user FAQ (setup, best workflow, moving older chats into the hub; screenshot checklist) in `docs/product/CHATGPT_CUSTOM_GPT_FAQ.md`.
* Milestone execution order: M8–M10 feature work preceded **M7** Dokploy packaging. M7 is staged as Dokploy Dev/UAT, then Prod after testing (`MILESTONE_TRACKING.md`, `ROADMAP.md`).
* Docs: ChatGPT Custom GPT Actions setup (verified read + write against public OpenAPI) in `MCP_CURSOR_SETUP.md`.
* Web middleware: allow unauthenticated `/mcp` through to the API rewrite (fixes MCP `initialize` EOF when clients hit `{WEB_URL}/mcp`).
* Web middleware: return JSON 404 for `/.well-known/*` so MCP OAuth discovery does not receive the login HTML page.
* Admin LLM wizard: **Antigravity** client tab with verified `agy` + Bearer stdio proxy setup; Gemini tab clarified as API/enterprise CLI.
* Workspace detail: per-section search, filter, and pagination for projects/systems/records; create actions use `LinkButton`.
* Imports: “New import” opens a type-picker modal (paste chat live; documents/images coming soon).
* Admin LLM wizard: **Claude** client (Desktop/Code MCP + claude.ai custom connector steps).

### Added

* **NF-009 closeout:** Monitoring **Export ops log** (`GET /api/v1/admin/monitoring/ops-log-export`); audit retention purge (`AUDIT_RETENTION_DAYS`); worker alerts for backup fail, error-like audit spikes, and backup-volume disk pressure (plus existing stale backup) via email/`ALERT_WEBHOOK_URL`, deduped in `ops-alerts-state.json`.
* **Mon-2 telemetry:** `knowledge.view` / `knowledge.search` audits (session + MCP); Monitoring shows top viewed records and hashed search terms (no raw queries).
* **M9 secret detection + auto-split:** import `content_warnings` (pattern counts only); acknowledge required for high-severity drafts; heuristic draft chunk suggestions from turns/headings.
* **NF-014 external platform status:** `GET /api/v1/platform/status` + MCP/`get_platform_status` (opt-in scope `monitoring:read`) expose the redacted support-dump snapshot for external monitors.
* **NF-009 stale-backup alerts:** worker poll (`BACKUP_STALE_ALERT_INTERVAL_MS`) emails system admins and optionally POSTs `ALERT_WEBHOOK_URL` when last-success is older than `BACKUP_STALE_AFTER_HOURS` (deduped stamp).
* **M9 structured importers:** ChatGPT export, Open WebUI, and generic JSON conversation paste → Markdown draft preview (`chatgpt_export` / `open_webui` / `generic_json`).
* **Automated backup schedule (admin):** Monitoring → Backups controls enable + interval presets (`1h`/`6h`/`12h`/`24h`/`7d`) via `BACKUP_DIR/schedule.json`; `db-backup` sidecar re-reads each cycle (env `BACKUP_ENABLED` / `BACKUP_INTERVAL_SECONDS` remain defaults).
* **Signup approval emails:** clearer confirm-mail/admin-wait copy; approval mail lists assigned workspaces/roles; system-admin **on duty** pref (`signupPendingApproval`); immediate admin notify on email confirm (fallback: all admins); worker escalation after `SIGNUP_PENDING_ESCALATE_AFTER_HOURS` (4/12/24); Monitoring shows on-duty admins.
* **NF-013 Knowledge media:** workspace JPEG/PNG/WebP library (`workspace_media`), BlobStore purpose `media`, editor **Insert image**, MCP `upload_workspace_media` / `list_workspace_media` / `delete_workspace_media`; Markdown embeds `/api/v1/media/:id`.
* **Wave E (until IdP):** Compose **seed** one-shot (**NF-002**); Monitoring **Mon-1** client leaderboard + catalogue tops; **NF-008** embedding reindex + archived counts; **Ops-2** avatars via BlobStore with local fallback; **NF-009** light support dump + stale-backup chip (`BACKUP_STALE_AFTER_HOURS`).
* **NF-006:** Admin → **Storage** for S3-compatible connection settings (override `BLOB_*` env, test connection); Monitoring offsite uses these settings with env fallback.
* **NF-006 / Ops-1:** `@project-knowledge-hub/blob-store` with `disabled` + **S3-compatible** provider; auto offsite upload after Monitoring export; worker sync for sidecar dumps; `last-offsite.json` + Monitoring **Push offsite**.
* **NF-011 Mon-0:** Admin → **Monitoring** (health + ready checks, MCP/session strip, backup stamps) with export / download / import (`CONFIRM REPLACE`), **manual dump delete**, and **retention / auto-rotate** controls (`retention.json`). `/status` redirects here. API `GET/POST/PUT/DELETE /api/v1/admin/monitoring…`; api image includes `postgresql-client`; Dokploy api mounts `knowledge_hub_backups`.
* **NF-005 Ops-0:** scheduled Postgres backups — Compose `db-backup` (Dokploy + local `--profile backup`), retention (7d/4w/3m), `export-db.sh` / `import-db.sh` (full replace + stamps), volume `knowledge_hub_backups`. Runbook in `OPERATIONS.md` / `DOKPLOY.md`.
* Docs: next-features **execution waves A–F** (merge NF-008 into Monitoring/NF-011; BlobStore 006→007; Prod spine NF-002→005→011) in `NEXT_FEATURES.md`.
* Docs: operations & maintenance backlog — scheduled/offsite DB backups, **export/import for cross-instance data moves**, `BlobStore` (S3-compatible + Azure Blob + optional OneDrive/SharePoint), admin maintenance console, observability (**NF-005**–**NF-009**) in `docs/deployment/OPERATIONS.md` / `NEXT_FEATURES.md`.
* Backlog **NF-010**: finer-grained access (project / knowledge-record roles) parked; workspace-level roles remain the default (`NEXT_FEATURES.md`).
* Backlog **NF-011**: Admin monitoring dashboard folds **Status** into Monitoring (MCP, sessions, catalogue usage) — design in `docs/product/ADMIN_MONITORING.md`.
* User-facing MCP setup wizard on Account → AI connections: members create scoped API clients for their workspaces (`POST /api/v1/me/api-clients`, rotate), run preflight/connection tests (`/api/v1/me/mcp/setup/*`), and copy Cursor/ChatGPT/Claude/… schemas, then **Finish** with a clear done step and connection troubleshooting (admin wizard shares the same finish/troubleshoot UX with extra diagnostics). Agent pairing remains a secondary path on the same page; admin wizard keeps org-wide options and public URL override.
* Backlog **NF-004**: ChatGPT MCP App (Developer Mode / Workspace) for normal-chat tools — separate from Custom GPT Actions and `/ai-discover` (`NEXT_FEATURES.md`).
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
* Tracking documents: `docs/CHANGELOG.md`, `docs/milestones/MILESTONE_TRACKING.md`, `docs/milestones/MILESTONE_0_IMPLEMENTATION_PLAN.md`.

## [0.1.0] - TBD

* First tagged release after Milestone 0 validation and packaging (Milestone 7).
