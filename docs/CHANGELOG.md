# Changelog

All notable changes to Project Knowledge Hub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

* **PRO-T-3: Human key resolution workspace scoping with intelligent ambiguity handling:** Project key prefixes (e.g. `CSA`, `PNZ`) are enforced unique only within a workspace, but human key resolution (document keys like `CSA-CONV-1`, task keys `WEB-T-15`, epic keys, milestone/sprint keys, RAID keys, change keys) now properly scopes to the caller's accessible workspaces with intelligent entity-based disambiguation. Previously, when two projects in different workspaces shared a prefix, key lookups would silently pick the first match globally, causing "not found" errors when the matched project was inaccessible or writes landing in wrong projects. **New behavior**: When multiple projects share a prefix across accessible workspaces, the resolver checks which ones actually contain the entity; resolves successfully if entity exists in exactly one project, returns clear "ambiguous key" error with project names only if entity exists in 2+ projects. REST API scopes by user's workspace memberships (system admins see all). MCP tools pass `allowedWorkspaceIds`. Cross-workspace prefix collision warnings added to project creation/update to prevent new ambiguous cases. Affects all MCP tools and REST API endpoints accepting human keys. No database migration required; existing duplicate prefixes remain valid. Comprehensive test coverage (23 tests) added.

* **PRO-T-6: Consistent numeric field types in MCP tools:** All money, rate, and hour fields (`initialBudget`, `approvedBudget`, `itBudgetAllocation`, `hourlyRate`, `forecastHours`, `actualHours`, `allocatedDailyHours`, `contractedBudget`, etc.) now consistently return as JSON numbers from all MCP read and write tools. Previously, PostgreSQL `numeric` columns were returned as strings from some tools (e.g., `get_project`, `get_system`, `list_project_stakeholders`) while other tools (e.g., `get_project_budget_summary`) returned numbers, causing type mismatches for LLM and MCP clients. Fixed by configuring Drizzle numeric columns with `mode: 'number'` and updating all DTOs and parsers.

### Added

* **User category (PRO-T-16):** `users.user_type` is `human` (default) or `system`. Existing rows become `human` (migration `0047`). System users are created without a password or invite and authenticate with API client tokens (`actingUserId`). Web sign-in (password, OIDC, reset/invite confirm, session cookies) refuses them. `POST /api/v1/users/:userId/change-category` is the only way to change the category; it is admin-only, audited, and revokes sessions and outstanding auth tokens when the target is `system`. Member lists and resource utilization omit system users unless `includeSystemUsers=true`. Assignment (task owner, RACI, RAID and change people, stakeholders) accepts active system users. Personal dashboard insights are unchanged.

* **Admin SSO settings:** Admin → SSO (`/admin/sso`) stores OIDC issuer, client id/secret, button label, IdP source, optional redirect URI, enable toggle, and JIT in `platform_settings` (`oidc_config`). Values override `OIDC_*` env at request time (no rebuild/restart). GET never returns the secret. “Reset to .env” clears the override. Login status/start/callback use the resolved config. Briefs [`OIDC_IDP.md`](product/OIDC_IDP.md), [`OIDC_AUTHENTIK_INTEGRATION_GUIDE.md`](product/OIDC_AUTHENTIK_INTEGRATION_GUIDE.md).

* **OIDC JIT provisioning:** optional just-in-time user create on first verified-email SSO (`OIDC_JIT_PROVISIONING` or Admin → SSO toggle, default off). New users are `active` with IdP fields set and no memberships; on-duty admins get email; dashboard waiting banner until a workspace role is assigned.

* **Ops Console landing + auth:** public landing; desktop login/register/forgot as landing modals; mobile still uses AuthCard pages. Ops top bar uses the same single theme/language cycle controls as the landing.

* **Context-aware Admin rail:** hide nav groups with no usable items; show groups from the **current route** (not last-used prefs). Ops section is Reports-only (MCP setup stays under the account menu / Admin).

* **Catalogue system OpEx in project AC:** non-AI systems linked to a project can set `it_cost_mode` (`flat` / `one_time` / `note_only`) with flat monthly, one-time, and soft allocation fields; billable OpEx rolls into Budgeting AC beside people + AI. Migration `0046`. UI create/manage + budget breakdown; MCP `create_system` / `update_system` cost args.

* **Agent catalogue systems + IT details:** opt-in MCP scope `catalogue:write` with direct `create_system` / `update_system` (ChatGPT via `call_hub_tool`); enriched `list_systems` / `get_system`; structured `it_details` jsonb (hostname, URLs, deployment, data class, support, …) plus UI fields for version/criticality/IT inventory. Migration `0045`. ADR-014 Tier B ships as direct tools for systems first (propose/commit later).

* **Open job roles + competencies (staffing):** project roster rows may be open seats (`user_id` null) with required job title, optional `roleDescription`, and competency tags `{ name, skillId }` (`skillId` reserved for a future catalog). Assign/unassign fill the same row; REST `POST …/project-stakeholders/:id/assign|unassign`; UI create toggle + Open badge; MCP `create_project_stakeholder` (optional `userId`), `assign_project_stakeholder`, `unassign_project_stakeholder`, `list_workspace_members` (ChatGPT via `call_hub_tool`). Migration `0044`.

* **Project Scrum (NF-020):** `project_sprints`, task `sprint_id` + story points, Delivery view **Scrum** (board, backlog, planning wizard, activate/close), ceremony drafts (RET/REV) linked to sprints, velocity, point burndown, project **Definition of Done**; REST `/project-sprints` + MCP; PDF export for scrum sections. Brief [`PROJECT_SCRUM.md`](product/PROJECT_SCRUM.md); ADR-022. Migrations `0042` / `0043`.

* **Knowledge document keys (NF-021):** project-scoped `{prefix}-{DOCCODE}-{n}` on knowledge records (`documentKeyType` / `documentNumber`); catalog `docKeyCode`; allocate on create; MCP/REST resolve by UUID or human key; keys shown before titles in catalogues, detail, and archive lists; demo seed keys. Brief [`PROJECT_DOC_KEYS.md`](product/PROJECT_DOC_KEYS.md); ADR-023. Migration `0041`.

* **Human-readable issue keys (ADR-019):** delivery/RAID keys `{prefix}-{TYPE}-{n}` (e.g. `HL1-T-12`, `HL1-RR-1`); baseline `keyPrefix`; RAID risk↔issue transfer without breaking typed codes; IDs across list/tree/board/calendar/timeline/scrum (toggleable where relevant).

* **Project Delivery suite (NF-018):** milestones, epic → user story → task hierarchy, due/target dates, RACI + current-owner handoffs, task activity, hybrid stakeholders (org chart, utilization, AI cost modes), RAID register, baseline (dates/charter/plan/initial stakeholders/DoD), change-management register, Delivery views **list / tree / board / calendar / timeline / scrum**, **budgeting/EVM** (currency, BAC, rates, forecast/actual hours, burndown, CPI/SPI), Timeline/Risks/Financials/Overall RAG; REST + project page UI; MCP `pm:read` / `pm:write`. Briefs [`PROJECT_DELIVERY.md`](product/PROJECT_DELIVERY.md), [`PROJECT_RAID.md`](product/PROJECT_RAID.md), [`PROJECT_BASELINE.md`](product/PROJECT_BASELINE.md), [`PROJECT_BUDGET.md`](product/PROJECT_BUDGET.md); ADR-015/016/017/018/019/020. Merged onto `feature/m7-dokploy` for Dokploy Dev smoke (not Prod until validated).

* **Delivery PDF exports:** timeline, board, calendar, and scrum printable PDFs aligned with on-screen filters (IDs, status colors, windows, sections); stakeholder org-chart PDF.

* **Project reports & dashboard insights:** personalized report diagrams; dashboard insight widgets alongside My tasks.

* **Dashboard My tasks deep links:** task titles open the project Delivery section with `?task=` and the manage modal; Manage button removed from the dashboard list.

* **OIDC sign-in (Authentik):** optional OpenID Connect login beside local email/password; operator integration guide; session links IdP subject when configured. Later: Admin → SSO UI + optional JIT (see Unreleased above).

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

### Changed

* **Mail chrome:** product emails (including Admin test send) use the Ops Console KnowHub layout — KH mark, IBM Plex stacks, ink CTA, 3px panels, green accent — instead of IN3 navy / “Project Knowledge Hub” chrome.

* **Responsive Delivery / Budgeting UX:** view mode controls use icons below `md` on the section title row; compact mobile header (brand mark, icon auth, menu far right); bottom-sheet modals + full-width toasts on small screens; Budgeting burndown opens on demand in a wide modal below `md`; epic cost rollups use compact cards on mobile and denser tables on desktop; approved-budget field width capped so Save stays visible.

* **German locale (de):** filled missing Scrum / ceremony / DoD / section-nav / document-key strings so DE no longer shows raw message keys.

* **MCP Project Delivery coverage:** sprint burndown + velocity tools; My tasks / dashboard insights; project delivery-document index; ceremony links to `sprint`; human/document keys on more knowledge + change/delivery-link tools; `list_knowledge_records` returns `humanKey`; MCP setup wizards can opt into `pm:read` / `pm:write`.

* **LLM OpenAPI / Gemini schemas:** ChatGPT Actions + OpenWebUI OpenAPI include first-class delivery tools (`create_project_task`, sprints, milestones, …) under the 30-op limit, plus `call_hub_tool` for the full catalog; Gemini function declarations include the full PM surface; `update_knowledge_record` supports soft-archive.

### Fixed

* **MCP list_record_metadata (PRO-T-4):** `updateKnowledgeRecord` guide now correctly marks `title`, `recordType`, and `contentMarkdown` as optional (not required), documents `recordId` and `archived` fields, and ensures field `requirement` values match the `requiredFields` / `optionalFields` lists and the `update_knowledge_record` tool schema.

* **MCP `search_knowledge` timestamp format (PRO-T-5):** `updatedAt` now returns ISO 8601 UTC (`2026-09-28T11:29:24.478Z`) instead of raw PostgreSQL format (`2026-09-28 11:29:24.478+00`), consistent with `get_knowledge_record` and `list_knowledge_records`. Also rounds `score` and `vectorScore` to 4 decimal places for cleaner output.

* **MCP list filter validation (PRO-T-7):** `list_project_tasks`, `list_project_user_stories`, `create_project_task`, `update_project_task`, `create_project_user_story`, and `update_project_user_story` now validate filter entities (milestone, sprint, epic, user story) and return clear errors when they belong to a different project. For human keys like `FUR-M-1`, the old error was `No project found for key prefix FUR` (even when project FUR existed); the new error is `Milestone FUR-M-1 does not belong to project PRO` (400, same workspace) or `Milestone FUR-M-1 not found in project PRO` (404, different workspace to prevent information leaks). **Behaviour change**: Previously, passing a UUID from another project's milestone/sprint/story/epic bypassed validation entirely (UUIDs were returned immediately by `resolveEntityId`) and would silently attach tasks or stories to cross-project entities. UUIDs are now validated with the same logic as human keys, blocking cross-project references with identical error messages. REST routes (`POST /api/v1/projects/:projectId/tasks` etc.) already had this validation via `assertMilestoneInProject` / `assertSprintInProject` / `assertUserStoryInProject`, so REST behaviour is unchanged.

* **PRO-T-8: Date validation and error handling (MCP/REST):** All date inputs (tasks, milestones, epics, stories, sprints, stakeholders, RAID, change items, baseline, and project start/end dates) now validate real calendar dates at the schema layer, rejecting impossible dates such as `2026-02-30`, `2026-13-01`, and non-leap `2027-02-29`. Shared `isoDateSchema` and `isoDateNullableSchema` in `@project-knowledge-hub/domain`. Database errors are properly sanitized: walks the `cause` chain to detect drizzle-orm's `DrizzleQueryError` wrapping postgres.js `PostgresError` with 5-character SQLSTATE codes; known Postgres error codes (22007/22008 invalid date, 22P02 invalid input, 23505 unique violation, 23503 foreign key violation) map to clean 4xx errors; unknown errors return `Internal error (ref: <correlation-id>)` with full server-side logging. Never returns raw SQL, params, table names, constraints, or internal IDs to clients. Error sanitizer shared between REST API and MCP server (both use allowlist: only AppError messages returned verbatim). REST API preserves Fastify framework errors (400 malformed JSON, 413 body too large, 415 unsupported media type, 429 rate limit, etc.) with their original status codes and safe messages. All errors logged server-side with full stack traces and error objects. Issue key allocation now happens in the same transaction as entity inserts, preventing key gaps when a create fails. Comprehensive unit tests for date validation, error sanitization (including real DrizzleQueryError shape), transactional allocation behavior, and MCP error result formatting. Uses `globalThis.crypto.randomUUID()` for browser compatibility.

* **PRO-T-9: Date range validation (MCP & REST):** All project entity create and update operations reject end dates before start dates. Covered entities: **epics** (startDate/endDate), **user stories** (startDate/endDate), **sprints** (startDate/endDate), **milestones** (startDate/targetDate), **stakeholders** (assignmentStart/End, contractStart/End), and **project baseline** (startDate/endDate). Validation applies to: MCP `create_project_epic/sprint/milestone/user_story/stakeholder` and their `update_*` variants, `update_project_baseline`, and REST `POST /api/v1/projects`, `PATCH /api/v1/projects/:id`. On create, validates input pair directly. On update, validates effective dates after merging patch with stored values (catches partial updates like setting only `endDate` to before stored `startDate`). Equal dates allowed; null dates skip check. Domain helpers `assertDateRange` / `effectiveDateRange` in `packages/domain`; error code `INVALID_DATE_RANGE` (400) with field names in message. Includes wiring tests proving validation runs before DB operations.

* **Task AI system validation (PRO-T-10):** `create_project_task`, `update_project_task`, and `report_project_task_ai_usage` now validate that `aiSystemId` is an AI assistant system linked to the task's project, matching the validation used by `update_project_ai_assistant_cost`. Error order avoids leaking information: 404 `SYSTEM_NOT_FOUND` for missing/archived/cross-workspace systems, 400 `SYSTEM_NOT_AI_ASSISTANT` for same-workspace non-AI systems, 400 `AI_SYSTEM_NOT_IN_PROJECT` for AI assistants linked to a different project. Previously, these tools accepted any catalogue system UUID, including non-AI systems, causing token usage to be charged to systems that were ignored by budget summaries. Tasks with legacy non-AI `aiSystemId` can still report usage without re-validation.

* **Media content type validation (PRO-T-11):** workspace media uploads (`upload_workspace_media` and chunked `begin` → `append` → `finalize_workspace_media_upload`) now verify file bytes against the declared content type using magic-byte signatures (PNG, JPEG, GIF, WebP). Uploads with mismatched or unrecognized content are rejected with `MEDIA_CONTENT_MISMATCH` before persisting. Media download responses now include `X-Content-Type-Options: nosniff` to prevent content-type confusion attacks.

* **MCP translation provenance (PRO-T-12):** `create_record_translation` via MCP now records `ai_generated_draft` + conversation/mcp source (matching `create_knowledge_record`), not hub-managed/manual. Provenance passed internally via options; REST/web UI unchanged. When `translateWithAi` is true, server-computed AI model wins over client-supplied `generatedByModel`. MCP tool accepts optional `generatedByModel` / `sourceTitle`; shared `mcpSource` helper centralizes provenance structure across create/translate/update handlers.

* **Stakeholder ID consistency (PRO-T-13, MCP-only):** MCP `list_project_stakeholders` now returns `id=rosterId` for all roster-backed entries (open and filled seats) via `toMcpStakeholder` adapter. Previously, filled seats returned `id=userId`, causing agents to fail when passing that `id` to mutation tools. Mutation tools (`update_project_stakeholder`, `assign_project_stakeholder`, `unassign_project_stakeholder`, `delete_project_stakeholder`) accept optional `projectId` (enables helpful userId→rosterId hints when a userId is passed by mistake) and require `stakeholderId` as the roster ID (rosterId from list). MCP authorization order fixed: when `projectId` is provided, access is checked BEFORE ID resolution (preventing information leaks). Single code path per handler: auth check (if projectId provided), resolve with optional fallback, fetch roster row, re-check project access (cheap), mutate, audit. REST responses unchanged (still return `id=userId` for filled seats; org chart `byId.has(managerUserId)` continues to work). Tool descriptions clarify that `stakeholderId` expects `rosterId` from list responses. Multi-seat user aggregation (one entry per user) remains a separate pre-existing issue. Trivial rebase against PR #16 will be needed (server.ts tool descriptions).

* **Knowledge-record Mermaid (Turbopack):** alias `d3-path` so diagrams load in the Next 16 / Turbopack dev graph.

* **Dashboard recent dates:** render timestamps with `LocalDateTime` to avoid hydration mismatch.

* **MCP `update_system` itDetails merge (PRO-T-14):** `itDetails` updates now merge by key (omitted keys preserved, `null` removes a key, arrays replaced). Previously, sending a partial `itDetails` silently replaced the entire object and deleted unmentioned fields. Web UI now sends explicit `null` for cleared fields. Added `systemItDetailsPatchSchema` for REST PATCH and MCP update validation.

* **Dokploy PDF export (Chromium crashpad):** API entrypoint sets a writable `HOME` / `XDG_*` for `knowledgehub` after `setpriv` (was inheriting `/root`); Puppeteer launch uses `/tmp` user-data + crash-dump flags so Chrome no longer fails with `chrome_crashpad_handler: --database is required`.

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
