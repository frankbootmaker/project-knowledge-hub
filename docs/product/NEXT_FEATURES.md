# Next features

Short backlog of product work **after** the current milestone track (see `ROADMAP.md` / [`../milestones/MILESTONE_TRACKING.md`](../milestones/MILESTONE_TRACKING.md)). Items here are not scheduled until their module or scope is described clearly enough to implement.

## How to use

1. Add a row when an idea is worth keeping but not ready to build.
2. Move an item to active work only after a short **module brief** exists (goals, boundaries, main entities/APIs, non-goals).
3. Prefer linking a design note under `docs/product/` rather than expanding this file into a full PRD.

---

## Recommended execution order

Optimize for **M7 Prod readiness** and avoid building overlapping Admin surfaces twice.

| Wave | Do | Skip / defer until |
| --- | --- | --- |
| **A — M7 closeout** | **NF-002** Compose bootstrap seed **done**; Dokploy Dev smoke | Rebuild + retest on each push |
| **B — Data safety** | **NF-005** Ops-0 **done** (schedule, retention, export/import, stamps, local volume). Ops-1 offsite after BlobStore | Full blob product |
| **C — Admin ops UI** | **NF-011** Mon-0 + **Mon-1** done (client leaderboard + catalogue tops). Embedding reindex + archived counts on Monitoring | Fancy charts |
| **D — Object storage** | **NF-006** BlobStore + **s3** + Admin → Storage + **Ops-2 avatars** done. **NF-013** knowledge media done. Imports/exports still later. **NF-007** Azure on same Storage page **with Entra IdP (NF-012)** | OneDrive/SharePoint |
| **E — Ops polish** | **NF-009** support dump + ops log export + retention + richer alerts; **NF-014** external status REST/MCP (`monitoring:read`) | Log shipping to external aggregator |
| **F — Product** | **NF-001** Doc Factory Phase E (style packs) in progress; content templates / forge later. **NF-018** Delivery + **NF-020** Scrum + **NF-021** doc keys on `feature/m7-dokploy` (smoke). **NF-019** Project AI governance next after smoke. **NF-004** ChatGPT MCP App, **NF-010** finer ACLs — only with real user jobs | Do not cut in front of A–C for parked items |

### Merge / optimize notes

* **NF-003** — done; keep as historical row only.
* **NF-008 ⊂ NF-011 (+ NF-005)** — do **not** ship a separate “Maintenance” top-level nav first. Monitoring health section owns: Status, backup age, export/import actions, later reindex/purge. NF-008 remains a checklist of actions folded into NF-011.
* **NF-006 + NF-007** — one **`BlobStore` program** on Admin → **Storage**. `s3` is live; **`azure_blob` lands with Microsoft Entra ID as IdP** (prefer Entra-backed auth over long-lived account keys). Graph OneDrive/SharePoint only when a library/export job exists. Do not dual-track two storage designs.
* **NF-009** — overlaps Audit export and Monitoring; build **after** Mon-0 so alerts have a home (Monitoring), not a third ops page.
* **NF-014** — expose the redacted Monitoring / support-dump snapshot for external monitors (REST + MCP); prefer a scoped read-only API client over session cookies.
* **NF-001 / NF-004 / NF-010** — stay parked; they do not unblock Prod packaging.

---

## Backlog

| ID | Feature | Status | Needs before build | Notes |
| --- | --- | --- | --- | --- |
| NF-001 | **Doc Factory** — style packs + Admin template manager on existing Blank PDF/DOCX export; content templates + AI/MCP fill; later hub OpenAI-compatible forge | `partial` — Phase E done; A–C/G later | Next: content templates (A–C); forge = Phase G (bind via Admin AI Providers `doc_forge`) | Brief: [`DOC_FACTORY.md`](DOC_FACTORY.md). Wave **F**. Admin LLM registry ships separately for translation/OCR. |
| NF-002 | **Dokploy bootstrap admin seed** — Compose one-shot `seed` service (after `migrate`) that creates the default org + admin when `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` are set; no-op if admin already exists | `done` | — | Wave **A**. [`DOKPLOY.md`](../deployment/DOKPLOY.md). |
| NF-003 | **User MCP setup wizard** — Account → AI connections guided create → test → schema copy for member workspaces | `done` | — | Shipped. Historical row. |
| NF-004 | **ChatGPT MCP App** — register KnowHub as a Developer Mode / Workspace MCP app so tools work in normal chats (tools menu / `@`), separate from Custom GPT Actions | `parked` — awaiting module brief | ChatGPT-compatible MCP auth (prefer OAuth/OIDC + refresh tokens; Bearer may suffice for personal Dev Mode only); map ChatGPT identity → KnowHub user/scopes; tool safety (read vs write); workspace publish runbook | Wave **F**. FAQ: [`CHATGPT_CUSTOM_GPT_FAQ.md`](CHATGPT_CUSTOM_GPT_FAQ.md). |
| NF-005 | **Ops backups + DB export/import** — scheduled Postgres dump, retention, restore drills; **export** dump artifact; **import** into same or another KnowHub instance; then offsite upload | `partial` — Ops-0 + Ops-1 (S3) done; alerts later | Prod gate = restore/import drill; Monitoring + offsite stamps | Wave **B**/**D**. [`OPERATIONS.md`](../deployment/OPERATIONS.md). |
| NF-006 | **BlobStore + S3-compatible storage** — shared object port for backups, avatars, media, future imports/exports | `partial` — port + `s3` + offsite dumps + avatars + **knowledge media** (local fallback when disabled) | Wire imports/exports; Azure as NF-007 | Wave **D**. Package `@project-knowledge-hub/blob-store`. |
| NF-007 | **Microsoft cloud storage** — Azure Blob on Admin → Storage; OneDrive/SharePoint via Graph later | `parked` — couple with Entra IdP | Prefer **Entra ID** auth for Azure Blob (same IdP workstream); account key/SAS only as escape hatch; Graph OAuth for OneDrive/SharePoint when a library job exists | After Entra sign-in (`users.idp_*` reserved). Same Storage UI as S3. |
| NF-008 | **Admin maintenance actions** — trigger export/import, reindex, purge policy (checklist) | `partial` — export/import + embedding reindex + archived counts on Monitoring; org-wide hard purge not from Monitoring | Per-entity purge remains Archive | Wave **C** with NF-011. |
| NF-009 | **Ops observability** — log retention/export, lightweight alerting, redacted support dump | `done` — support dump + ops log export + audit retention + worker alerts (stale/fail backup, error spike, disk) via `ALERT_WEBHOOK_URL` | Log shipping to external aggregator | Wave **E**. [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-4. |
| NF-010 | **Finer-grained access** — optional project- and/or knowledge-record-level roles beyond workspace membership | `parked` — not needed yet | Module brief: inheritance vs explicit grants, UI for assign/revoke, MCP/API client scope mapping, audit events | Wave **F**. Workspace roles sufficient today. |
| NF-011 | **Admin monitoring dashboard** — folds **Status** into Monitoring; MCP/sessions/catalogue; backup/import stamps; maintenance actions | `partial` — Mon-0 + Mon-1 + **Mon-2** view/search telemetry | Mon-3 rollups; anomaly chips | Wave **C**. [`ADMIN_MONITORING.md`](ADMIN_MONITORING.md). |
| NF-012 | **Microsoft Entra ID (OIDC) sign-in** — point generic OIDC at Entra (or broker via Authentik) | `parked` — reuses NF-017 | Entra app registration / issuer URL; same invite/link rules; unlocks Entra-auth **Azure Blob** on Storage (NF-007) | Pair with NF-007. Human SSO brief: [`OIDC_IDP.md`](OIDC_IDP.md). |
| NF-013 | **Knowledge media** — workspace image library (JPEG/PNG/WebP) for Markdown embeds; optional link to a knowledge record; human editor insert + MCP upload | `done` | SVG later | BlobStore purpose `media`. Embed URL `/api/v1/media/:id`. MCP: `upload_workspace_media` / `list_workspace_media` / `delete_workspace_media`. |
| NF-014 | **External platform status** — expose the redacted Monitoring / support-dump snapshot to external monitoring systems via REST and MCP | `done` — `GET /api/v1/platform/status` + MCP `get_platform_status` with opt-in `monitoring:read` | — | Wave **E**. Same payload as Admin support dump. Complements NF-009 alerts. |
| NF-015 | **Document / image import (MarkItDown)** — Import picker Documents + Images → convert via `kh-markitdown` sidecar → draft knowledge records; selectable OCR (`none` / `vision` / `tesseract`) | `done` (first slice) | Audio/YouTube/ZIP batch; Azure Doc Intelligence | Brief: [`DOCUMENT_IMPORT.md`](DOCUMENT_IMPORT.md). Lifts PRD deferral of PDF/DOCX ingest for hub drafts. |
| NF-016 | **Multilingual knowledge records** — content language + linked translation families | `done` — Phase 1 + Phase 2 + AI translate (`translateWithAi`) via Admin AI Providers / `VISION_LLM_*` | Same-slug URLs / `?lang=`; preferred_locale redirect; locale-aware FTS; re-translate existing sibling | Wave **F**. Distinct slugs per language; group id links siblings. |
| NF-017 | **OIDC sign-in (Authentik first)** — generic OIDC alongside local passwords; invite/link-only user binding | `partial` — v1 env + login button + PKCE callback | Staging smoke with real Authentik; Admin IdP UI; group→role mapping later | Brief: [`OIDC_IDP.md`](OIDC_IDP.md). Operator guide: [`OIDC_AUTHENTIK_INTEGRATION_GUIDE.md`](OIDC_AUTHENTIK_INTEGRATION_GUIDE.md). Wave **F** / IdP. NF-012 Entra reuses this path. |
| NF-018 | **Project Delivery** — milestones, epic→story→task, dates, RACI + handoffs, RAID, baseline/change register, delivery Timeline, budgeting/EVM + multi-RAG; REST/UI + MCP `pm:read`/`pm:write` | `partial` — merged to `feature/m7-dokploy` | Dokploy Dev smoke; then promote when stable | Briefs: [`PROJECT_DELIVERY.md`](PROJECT_DELIVERY.md), [`PROJECT_RAID.md`](PROJECT_RAID.md), [`PROJECT_BASELINE.md`](PROJECT_BASELINE.md), [`PROJECT_BUDGET.md`](PROJECT_BUDGET.md). ADR-015/016/017/018. Wave **F**. |
| NF-019 | **Project AI governance** — AI role (tool/deliverable), scope/charter, delivery HITL policy, AI-tagged RAID, AI system life cycle, stakeholder AI expectations, benefits vs AI spend, ethics checklist | `planned` — brief + ADR ready | Parked until after NF-018/020/021 smoke; then Phase A baseline AI role/scope | Brief: [`PROJECT_AI_GOVERNANCE.md`](PROJECT_AI_GOVERNANCE.md). ADR-021. Builds on ADR-013/020. Wave **F**. |
| NF-020 | **Project Scrum / sprints** — `project_sprints`, task `sprint_id` + story points, delivery view `scrum`, planning wizard, ceremony knowledge links, velocity / point burndown, project DoD | `done` — A–E on `feature/m7-dokploy` | Smoke in UI; then unpark NF-019 if desired | Brief: [`PROJECT_SCRUM.md`](PROJECT_SCRUM.md). ADR-022. Wave **F**. |
| NF-021 | **Knowledge document human keys** — project-scoped `{prefix}-{DOCCODE}-{n}` on knowledge records; catalog `docKeyCode`; MCP/REST resolve UUID or key | `done` — schema/allocate/resolve/UI + demo seed on `feature/m7-dokploy` | Smoke create+MCP get by key | Brief: [`PROJECT_DOC_KEYS.md`](PROJECT_DOC_KEYS.md). ADR-023 (extends ADR-019). Wave **F**. |
| NF-022 | **Job portal** — advertise open project roles, collect applications, hire into the same roster seat | `parked` — idea brief only | Open-role staffing stable in Prod; skill catalog (`skillId`); publish/apply/hire UX + ACL decisions | Brief: [`PROJECT_JOB_PORTAL.md`](PROJECT_JOB_PORTAL.md). Builds on open roles + competencies. Wave **F** (later). |
| NF-023 | **Commercial proposal from plan** — generate a `proposal` from plan/forecast costs with a configurable margin % on internal prices | `parked` — idea brief only | Budgeting forecast + system OpEx stable; decide margin scope (people vs AI/systems) and BAC seed rules | Brief: [`PROJECT_PROPOSAL.md`](PROJECT_PROPOSAL.md). Builds on Baseline plan pin + Budgeting. Wave **F** (later). |


---

## Suggested module brief (for NF-001)

When ready to implement, follow [`DOC_FACTORY.md`](DOC_FACTORY.md). At minimum confirm:

* **Surfaces** — Admin → Templates (style packs; later content templates); Workspace → Document factory; Record → Export (existing Blank + optional style pack)
* **Boundaries** — Markdown SoT; Blank export already viewer-faithful; style packs presentation-only; hybrid MCP first; optional hub OpenAI-compatible forge later; never auto-Approve
* **v1 slice** — **Phase E** (style packs on existing export), then A–C (content templates); forge / hub LLM later
* **Out of scope** — Rebuilding Blank export; Word WYSIWYG editor; PPTX; writing binary DOCX as system of record; auto-approve AI drafts

Until implementation starts, treat Doc Factory as backlog only — no UI, export pipeline, or new MCP tools beyond what the spike already documented.

---

## Suggested module brief (for NF-006 / NF-007)

When ready, describe at least:

* **`BlobStore` package home** and which app paths move first (backups only vs avatars vs imports)
* **Provider v1 set** (`s3`, `azure_blob`; Graph OneDrive/SharePoint yes/no for v1)
* **Auth models** per provider (access keys, SAS, Entra ID / OAuth)
* **Key/prefix layout** and retention for `backups/` vs `app/`
* **Non-goals** (e.g. OneDrive as sole DR, multi-region active-active)

Full ops phasing and restore drill: [`docs/deployment/OPERATIONS.md`](../deployment/OPERATIONS.md).

---

## Suggested module brief (for NF-010)

When ready, describe at least:

* **Triggering user jobs** (e.g. contractor limited to one project; classified / restricted knowledge)
* **Grant model** — inherit from workspace vs explicit project/record ACLs; who can assign
* **Surfaces** — Admin UI, Account “workspace roles” extension, MCP / API client scopes
* **v1 scope** — project-level only vs record-level / sensitivity flags
* **Non-goals** — replacing workspace membership as the default tenancy boundary

---

## Suggested module brief (for NF-018)

When implementing or extending Project Delivery, follow [`PROJECT_DELIVERY.md`](PROJECT_DELIVERY.md) and ADR-015. At minimum confirm:

* **Surfaces** — Project detail → Delivery; REST under `/api/v1/projects/:id/milestones|tasks`; MCP `pm:read` / `pm:write`
* **Boundaries** — First-class milestones/tasks/RACI; knowledge stays draft-only; delivery commits live
* **v1 slice** — one Accountable per task; workspace members only; soft cancel via status
* **Non-goals** — Jira sync, Gantt, notifications, project-level ACLs (NF-010)

---

## Suggested module brief (for NF-019)

When implementing Project AI governance, follow [`PROJECT_AI_GOVERNANCE.md`](PROJECT_AI_GOVERNANCE.md) and ADR-021. At minimum confirm:

* **Surfaces** — Baseline (AI role/scope), HITL policy editor, RAID AI tags, Systems life cycle, Budget benefits footnote
* **Boundaries** — Extends delivery/RAID/baseline/budget; does not invent a parallel GRC product; no portfolio layer
* **v1 slice** — Phase A (`aiRole` + charter pin), then B (HITL soft-block for MCP)
* **Non-goals** — ISO/IEC 42001 certification kit; quoting/shipping PMI standard text in the product; training models on `docs/pmi/`

---

## Suggested module brief (for NF-020)

When implementing Scrum, follow [`PROJECT_SCRUM.md`](PROJECT_SCRUM.md) and ADR-022. At minimum confirm:

* **Surfaces** — Project → Delivery → view `scrum`; planning wizard; close-sprint → retro link
* **Boundaries** — Sprints orthogonal to milestones; points ≠ EVM AC; board view stays status kanban
* **v1 slice** — Schema + scrum view + wizard; ceremonies after NF-021
* **Non-goals** — SAFe / PI planning; auto-approve ceremony drafts

---

## Suggested module brief (for NF-021)

When implementing knowledge document keys, follow [`PROJECT_DOC_KEYS.md`](PROJECT_DOC_KEYS.md) and ADR-023. At minimum confirm:

* **Surfaces** — Record catalogue/detail humanKey badge; MCP get/update by key
* **Boundaries** — Project-scoped only; immutable key; shares `issue_counters` with delivery codes
* **v1 slice** — Catalog codes + migration/backfill + allocate on create + resolve
* **Non-goals** — Workspace-global keys; slug == humanKey

---

## Suggested module brief (for NF-011)

When ready, describe at least:

* **v1 panels** (health from Status + MCP / sessions / catalogue) and time ranges
* **Status merge** — redirect `/status` → Monitoring; sidebar link rename
* **Maintenance actions** absorbed from NF-008 (export/import triggers, later reindex/purge)
* **Which audit actions are required** vs new instrumentation (`knowledge.view`, search, rate limits)
* **API shape** (`/api/v1/admin/monitoring/…`) and retention
* **Privacy** (no content dumps; IP handling)
* **Non-goals** (not replacing Audit; no end-user analytics; no permanent separate Status or Maintenance nav)

Design note: [`ADMIN_MONITORING.md`](ADMIN_MONITORING.md).
