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
| **A — M7 closeout** | **NF-002** (Compose bootstrap seed) if still manual; Dokploy Dev smoke | **Done for Dev:** Dokploy deploy works; rebuild + retest on each push. Seed one-shot may still be optional. |
| **B — Data safety** | **NF-005** Ops-0 **done** (schedule, retention, export/import, stamps, local volume). Ops-1 offsite after BlobStore | Full blob product |
| **C — Admin ops UI** | **NF-011** Mon-0 **done** (Status→Monitoring, MCP/sessions, backup export/import UI). Mon-1+ usage panels next | Fancy charts |
| **D — Object storage** | **NF-006** `BlobStore` + S3-compatible (offsite dumps + avatars); then **NF-007** Azure Blob as second provider; OneDrive/SharePoint last (export sink only) | Treat 006+007 as one port, staged providers |
| **E — Ops polish** | **NF-009** alerts + log export + support dump; **NF-011** Mon-1+ usage panels; remaining purge/reindex knobs if not already on Monitoring | — |
| **F — Product (parked)** | **NF-001** Doc Factory, **NF-004** ChatGPT MCP App, **NF-010** finer ACLs — only with module briefs and real user jobs | Do not cut in front of A–C |

### Merge / optimize notes

* **NF-003** — done; keep as historical row only.
* **NF-008 ⊂ NF-011 (+ NF-005)** — do **not** ship a separate “Maintenance” top-level nav first. Monitoring health section owns: Status, backup age, export/import actions, later reindex/purge. NF-008 remains a checklist of actions folded into NF-011.
* **NF-006 + NF-007** — one **`BlobStore` program**; implement `s3` first, `azure_blob` second, Graph OneDrive/SharePoint only when a library/export job exists. Do not dual-track two storage designs.
* **NF-009** — overlaps Audit export and Monitoring; build **after** Mon-0 so alerts have a home (Monitoring), not a third ops page.
* **NF-001 / NF-004 / NF-010** — stay parked; they do not unblock Prod packaging.

---

## Backlog

| ID | Feature | Status | Needs before build | Notes |
| --- | --- | --- | --- | --- |
| NF-001 | **Doc Factory** — standard documents (overview, management summary, progress summary, …) filled from workspace knowledge via connected AI (MCP), versioned in the hub, export PDF/DOCX | `parked` — awaiting precise module description | Module brief: package/module boundaries, UX entry points, template ownership, export scope | Early design spike: [`DOC_FACTORY.md`](DOC_FACTORY.md). Branch `feature/docfactory` holds spike notes + domain type stubs only. Wave **F**. |
| NF-002 | **Dokploy bootstrap admin seed** — Compose one-shot `seed` service (after `migrate`) that creates the default org + admin when `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` are set; no-op if admin already exists | `ready` — small ops follow-up | Wire into `compose.dokploy.yaml`; document secrets; avoid empty-env Zod failures | Wave **A**. See [`DOKPLOY.md`](../deployment/DOKPLOY.md). |
| NF-003 | **User MCP setup wizard** — Account → AI connections guided create → test → schema copy for member workspaces | `done` | — | Shipped. Historical row. |
| NF-004 | **ChatGPT MCP App** — register KnowHub as a Developer Mode / Workspace MCP app so tools work in normal chats (tools menu / `@`), separate from Custom GPT Actions | `parked` — awaiting module brief | ChatGPT-compatible MCP auth (prefer OAuth/OIDC + refresh tokens; Bearer may suffice for personal Dev Mode only); map ChatGPT identity → KnowHub user/scopes; tool safety (read vs write); workspace publish runbook | Wave **F**. FAQ: [`CHATGPT_CUSTOM_GPT_FAQ.md`](CHATGPT_CUSTOM_GPT_FAQ.md). |
| NF-005 | **Ops backups + DB export/import** — scheduled Postgres dump, retention, restore drills; **export** dump artifact; **import** into same or another KnowHub instance; then offsite upload | `partial` — Ops-0 done; Ops-1 offsite pending | Prod gate = restore/import drill on Dev; Monitoring reads stamps (**NF-011**); Ops-1 needs BlobStore (**NF-006**) | Wave **B**. [`OPERATIONS.md`](../deployment/OPERATIONS.md). Selective workspace transplant later. |
| NF-006 | **BlobStore + S3-compatible storage** — shared object port for backups, avatars, future imports/exports | `parked` — awaiting implementation brief | `BlobStore` interface; provider `s3` (AWS/R2/B2/MinIO/Garage/…); env + prefixes `backups/` vs `app/` | Wave **D** (first provider). Same port as NF-007. |
| NF-007 | **Microsoft cloud storage** — Azure Blob Storage for durable objects; OneDrive/SharePoint via Microsoft Graph for library/export jobs | `parked` — awaiting module brief | Azure auth (account key / SAS / Entra); Graph OAuth for OneDrive/SharePoint; map to same `BlobStore` (or export sink) jobs | Wave **D** after NF-006. Azure Blob before OneDrive. |
| NF-008 | **Admin maintenance actions** — trigger export/import, reindex, purge policy (checklist) | `partial` — export/import on Monitoring; reindex/purge later | Remaining actions on Monitoring | Wave **C** with NF-011. |
| NF-009 | **Ops observability** — log retention/export, lightweight alerting, redacted support dump | `parked` — awaiting brief | Log export (M7 deferred), webhook/email alerts, support package without secrets/raw pastes | Wave **E**. [`OPERATIONS.md`](../deployment/OPERATIONS.md) Ops-4. |
| NF-010 | **Finer-grained access** — optional project- and/or knowledge-record-level roles beyond workspace membership | `parked` — not needed yet | Module brief: inheritance vs explicit grants, UI for assign/revoke, MCP/API client scope mapping, audit events | Wave **F**. Workspace roles sufficient today. |
| NF-011 | **Admin monitoring dashboard** — folds **Status** into Monitoring; MCP/sessions/catalogue; backup/import stamps; maintenance actions | `partial` — Mon-0 done | Mon-1+ catalogue/client panels | Wave **C**. [`ADMIN_MONITORING.md`](ADMIN_MONITORING.md). |

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
