# Next features

Short backlog of product work **after** the current milestone track (see `ROADMAP.md` / `MILESTONE_TRACKING.md`). Items here are not scheduled until their module or scope is described clearly enough to implement.

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
| **E — Ops polish** | **NF-009** light v1 done (support dump + stale-backup chip); **NF-014** external status REST/MCP; full webhook/email alerts later | Log shipping |
| **F — Product (parked)** | **NF-001** Doc Factory, **NF-004** ChatGPT MCP App, **NF-010** finer ACLs — only with module briefs and real user jobs | Do not cut in front of A–C |

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
| NF-001 | **Doc Factory** — standard documents (overview, management summary, progress summary, …) filled from workspace knowledge via connected AI (MCP), versioned in the hub, export PDF/DOCX | `parked` — awaiting precise module description | Module brief: package/module boundaries, UX entry points, template ownership, export scope | Early design spike: [`DOC_FACTORY.md`](DOC_FACTORY.md). Branch `feature/docfactory` holds spike notes + domain type stubs only. Wave **F**. |
| NF-002 | **Dokploy bootstrap admin seed** — Compose one-shot `seed` service (after `migrate`) that creates the default org + admin when `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` are set; no-op if admin already exists | `done` | — | Wave **A**. [`DOKPLOY.md`](../deployment/DOKPLOY.md). |
| NF-003 | **User MCP setup wizard** — Account → AI connections guided create → test → schema copy for member workspaces | `done` | — | Shipped. Historical row. |
| NF-004 | **ChatGPT MCP App** — register KnowHub as a Developer Mode / Workspace MCP app so tools work in normal chats (tools menu / `@`), separate from Custom GPT Actions | `parked` — awaiting module brief | ChatGPT-compatible MCP auth (prefer OAuth/OIDC + refresh tokens; Bearer may suffice for personal Dev Mode only); map ChatGPT identity → KnowHub user/scopes; tool safety (read vs write); workspace publish runbook | Wave **F**. FAQ: [`CHATGPT_CUSTOM_GPT_FAQ.md`](CHATGPT_CUSTOM_GPT_FAQ.md). |
| NF-005 | **Ops backups + DB export/import** — scheduled Postgres dump, retention, restore drills; **export** dump artifact; **import** into same or another KnowHub instance; then offsite upload | `partial` — Ops-0 + Ops-1 (S3) done; alerts later | Prod gate = restore/import drill; Monitoring + offsite stamps | Wave **B**/**D**. [`OPERATIONS.md`](../deployment/OPERATIONS.md). |
| NF-006 | **BlobStore + S3-compatible storage** — shared object port for backups, avatars, media, future imports/exports | `partial` — port + `s3` + offsite dumps + avatars + **knowledge media** (local fallback when disabled) | Wire imports/exports; Azure as NF-007 | Wave **D**. Package `@project-knowledge-hub/blob-store`. |
| NF-007 | **Microsoft cloud storage** — Azure Blob on Admin → Storage; OneDrive/SharePoint via Graph later | `parked` — couple with Entra IdP | Prefer **Entra ID** auth for Azure Blob (same IdP workstream); account key/SAS only as escape hatch; Graph OAuth for OneDrive/SharePoint when a library job exists | After Entra sign-in (`users.idp_*` reserved). Same Storage UI as S3. |
| NF-008 | **Admin maintenance actions** — trigger export/import, reindex, purge policy (checklist) | `partial` — export/import + embedding reindex + archived counts on Monitoring; org-wide hard purge not from Monitoring | Per-entity purge remains Archive | Wave **C** with NF-011. |
| NF-009 | **Ops observability** — log retention/export, lightweight alerting, redacted support dump | `partial` — light v1: support dump + stale-backup chip (`BACKUP_STALE_AFTER_HOURS`, default 36h) | Log export, webhook/email alerts | Wave **E**. [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-4. |
| NF-010 | **Finer-grained access** — optional project- and/or knowledge-record-level roles beyond workspace membership | `parked` — not needed yet | Module brief: inheritance vs explicit grants, UI for assign/revoke, MCP/API client scope mapping, audit events | Wave **F**. Workspace roles sufficient today. |
| NF-011 | **Admin monitoring dashboard** — folds **Status** into Monitoring; MCP/sessions/catalogue; backup/import stamps; maintenance actions | `partial` — Mon-0 + **Mon-1** done (clients leaderboard + top records/projects/systems) | Mon-2 `knowledge.view` / search telemetry; Mon-3 rollups | Wave **C**. [`ADMIN_MONITORING.md`](ADMIN_MONITORING.md). |
| NF-012 | **Microsoft Entra ID (OIDC) sign-in** — org IdP login alongside local passwords | `parked` — awaiting module brief | OIDC app registration; map Entra subject → `users.idp_source` / `idp_subject`; session + invite flows; unlocks Entra-auth **Azure Blob** on Storage (NF-007) | See [`SECURITY_MODEL.md`](../security/SECURITY_MODEL.md). Pair with NF-007. |
| NF-013 | **Knowledge media** — workspace image library (JPEG/PNG/WebP) for Markdown embeds; optional link to a knowledge record; human editor insert + MCP upload | `done` | SVG later; Import-picker “images → draft record” still separate | BlobStore purpose `media`. Embed URL `/api/v1/media/:id`. MCP: `upload_workspace_media` / `list_workspace_media` / `delete_workspace_media`. |
| NF-014 | **External platform status** — expose the redacted Monitoring / support-dump snapshot to external monitoring systems via REST and MCP | `parked` — idea captured | Auth model (scoped API client / read-only token); stable JSON contract; MCP tool name + rate limits; no secrets in payload | Wave **E**. Reuse shape of `GET /api/v1/admin/monitoring/support-dump`. Complements NF-009 alerts. |

---

## Suggested module brief (for NF-001)

When ready, describe at least:

* **Module name and home** (e.g. new package vs `apps/api` lib + web routes)
* **User jobs** (who creates/regenerates/exports; when)
* **Boundaries** with knowledge records, MCP, and any future LLM path
* **v1 templates and scope model** (workspace / project / system)
* **Out of scope** for the first slice

Until that brief exists, treat Doc Factory as backlog only — no UI, export pipeline, or MCP tools beyond what the spike already documented.

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
