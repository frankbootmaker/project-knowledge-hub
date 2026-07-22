# Next features

Short backlog of product work **after** the current milestone track (see `ROADMAP.md` / `MILESTONE_TRACKING.md`). Items here are not scheduled until their module or scope is described clearly enough to implement.

## How to use

1. Add a row when an idea is worth keeping but not ready to build.
2. Move an item to active work only after a short **module brief** exists (goals, boundaries, main entities/APIs, non-goals).
3. Prefer linking a design note under `docs/product/` rather than expanding this file into a full PRD.

---

## Backlog

| ID | Feature | Status | Needs before build | Notes |
| --- | --- | --- | --- | --- |
| NF-001 | **Doc Factory** — standard documents (overview, management summary, progress summary, …) filled from workspace knowledge via connected AI (MCP), versioned in the hub, export PDF/DOCX | `parked` — awaiting precise module description | Module brief: package/module boundaries, UX entry points, template ownership, export scope | Early design spike: [`DOC_FACTORY.md`](DOC_FACTORY.md). Branch `feature/docfactory` holds spike notes + domain type stubs only. **Does not** displace M9. |
| NF-002 | **Dokploy bootstrap admin seed** — Compose one-shot `seed` service (after `migrate`) that creates the default org + admin when `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` are set; no-op if admin already exists | `ready` — small ops follow-up | Wire into `compose.dokploy.yaml`; document secrets; avoid empty-env Zod failures | Removes manual `tsx` seed in Dokploy terminal. See [`docs/deployment/DOKPLOY.md`](../deployment/DOKPLOY.md) follow-ups. |
| NF-003 | **User MCP setup wizard** — Account → AI connections guided create → test → schema copy for member workspaces | `done` | — | Shipped: `/account/ai-connections` + `POST /api/v1/me/api-clients` + `/api/v1/me/mcp/setup/*`. Pairing panel kept as secondary path. |
| NF-004 | **ChatGPT MCP App** — register KnowHub as a Developer Mode / Workspace MCP app so tools work in normal chats (tools menu / `@`), separate from Custom GPT Actions | `parked` — awaiting module brief | ChatGPT-compatible MCP auth (prefer OAuth/OIDC + refresh tokens; Bearer may suffice for personal Dev Mode only); map ChatGPT identity → KnowHub user/scopes; tool safety (read vs write); workspace publish runbook | Does **not** replace Custom GPT Actions or `/ai-discover`. Until this ships, use the Custom GPT path — user FAQ: [`CHATGPT_CUSTOM_GPT_FAQ.md`](CHATGPT_CUSTOM_GPT_FAQ.md). |
| NF-005 | **Ops backups** — scheduled Postgres dump, retention, restore drills; then offsite dump upload | `parked` — design captured | Schedule host (cron / worker), retention policy, encryption, alert on stale backup; Prod gate = restore drill | Builds on `backup-db.sh` / `restore-db.sh`. Plan: [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-0/Ops-1. Required before calling M7 Prod backup complete. |
| NF-006 | **BlobStore + S3-compatible storage** — shared object port for backups, avatars, future imports/exports | `parked` — awaiting implementation brief | `BlobStore` interface; provider `s3` (AWS/R2/B2/MinIO/Garage/…); env + prefixes `backups/` vs `app/` | Preferred default for self-host and non-Azure clouds. See [`OPERATIONS.md`](../deployment/OPERATIONS.md). |
| NF-007 | **Microsoft cloud storage** — Azure Blob Storage for durable objects; OneDrive/SharePoint via Microsoft Graph for library/export jobs | `parked` — awaiting module brief | Azure auth (account key / SAS / Entra); Graph OAuth for OneDrive/SharePoint; map to same `BlobStore` (or export sink) jobs | Azure Blob = peer to S3 for backups/app blobs. OneDrive/SharePoint = optional user/org library or export destination — **not** sole DR store. See [`OPERATIONS.md`](../deployment/OPERATIONS.md). |
| NF-008 | **Admin maintenance console** — ops panel: last backup, trigger backup, reindex, purge policy, queue/Redis/migrate version | `parked` — awaiting UX brief | Extend `/status` or Admin → Maintenance; system-admin only | Depends on NF-005 (and optionally NF-006) for backup actions. [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-3. |
| NF-009 | **Ops observability** — log retention/export, lightweight alerting, redacted support dump | `parked` — awaiting brief | Log export (M7 deferred), webhook/email alerts, support package without secrets/raw pastes | [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-4. |

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
