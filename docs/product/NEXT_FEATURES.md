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

---

## Suggested module brief (for NF-001)

When ready, describe at least:

* **Module name and home** (e.g. new package vs `apps/api` lib + web routes)
* **User jobs** (who creates/regenerates/exports; when)
* **Boundaries** with knowledge records, MCP, and any future LLM path
* **v1 templates and scope model** (workspace / project / system)
* **Out of scope** for the first slice

Until that brief exists, treat Doc Factory as backlog only — no UI, export pipeline, or MCP tools beyond what the spike already documented.
