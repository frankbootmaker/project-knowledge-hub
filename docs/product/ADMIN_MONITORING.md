# Admin monitoring dashboard

**Status:** Mon-0 + **Mon-1** shipped (**NF-011**); maintenance strip (**NF-008**); light support dump / stale backup (**NF-009**)  
**Home:** Admin sidebar → **Monitoring** (absorbs today’s **Status**)  
**Related:** Admin → Audit, `/status` → redirects here, MCP audit actions (`mcp.request`, `mcp.tool_call`, `mcp.tool_error`), API `/health` + `/ready`, Ops-0 stamps (`BACKUP_DIR`)

## Why

Operators need a **live picture** of how humans and AI clients use the hub—not only a raw audit trail. Audit stays the forensic log; Monitoring is aggregated, time-bounded, and glanceable. **Platform health** (former Status page) belongs at the top of the same screen so ops do not bounce between two admin links.

## Placement

| Surface | Role |
| --- | --- |
| **Admin → Monitoring** | **Platform health** (DB/Redis/API ready, queues, backup age when available) **plus** usage dashboards (MCP, sessions, catalogue) |
| **Admin → Audit** | Searchable event stream + export (keep as-is) |
| **`/status`** | Retire as a separate nav item; **redirect** to Monitoring (or keep as a deep alias to the health section) so bookmarks still work |

System-admin only. No workspace-admin personal “analytics” in v1 (privacy + scope).

## v1 panels (suggested)

### Platform health (from Status)

Lead the page with the current Status content so Monitoring is useful even when usage charts are empty:

* Overall health badge (ok / degraded)
* API `/health` + `/ready` dependency rows (Postgres, Redis, …)
* Queue / worker signals when exposed
* Last backup age (when **NF-005** Ops-0 stamps exist: volume `/backups/last-success.json`) and last successful **import** stamp (`last-import.json`) for cross-instance moves
* Embedding reindex backlog (M10)
* Optional migrate / app version labels

Reuse the existing Status UI patterns (colored `Badge`s, no left accent bars) as the **first section** of Monitoring rather than inventing a second health story (**NF-008** maintenance actions can sit beside or below this strip later).

### MCP activity

* Request volume over time (1h / 24h / 7d)
* Top tools (`list_*`, `search_*`, `get_*`, `create/update` drafts)
* Top API clients / acting users
* Error rate (`mcp.tool_error` vs `mcp.tool_call`)
* Rate-limit hits (if recorded) and truncated/oversized responses
* Recent MCP traffic sample (last N events → deep link to Audit)

**Sources today:** `audit_events` with `action` in `mcp.*` and `actorType: api_client`. Enrich metadata if client name / tool / workspace id are incomplete.

### Sessions & users

* Active sessions (non-revoked, not expired) — count + optional list (user, started/last seen if available)
* Sign-ins last 24h / 7d
* Pending approvals (users, AI pairing clients) as ops attention chips

**Sources:** `sessions`, auth audit actions, `users.status`, `api_clients.status = pending_approval`.

### Catalogue usage

* Most opened / fetched knowledge records (web + MCP `get` if auditable)
* Most searched terms or search hit counts (if search is audited; else defer)
* Hottest projects / systems (by linked record reads or updates)
* Create/update volume by lifecycle (draft vs verified) and by actor type (user vs api_client)

**Gap:** browser “open record” may not always audit today—v1 can start from MCP + mutation audits; add lightweight `knowledge.view` (sampled or always) if product needs true “most read”.

## Additional suggestions (beyond your list)

| Idea | Why |
| --- | --- |
| **Client health** | Last MCP success per API client; stale/revoked clients |
| **Write draft funnel** | MCP drafts created vs human-verified/current (AI → hub quality loop) |
| **Workspace heat** | Activity by workspace (useful with multi-workspace demo) |
| **Git sync pulse** | Last sync / error connections (M8) |
| **Security anomalies** | Failed logins, sudden MCP error spikes, new client from unusual IP |
| **Retention note** | Monitoring aggregates need retention policy (e.g. 30–90 days rollups) separate from full audit retention |

## Non-goals (v1)

* End-user / workspace-admin analytics product
* Real-time packet capture or full request body browser (PII / secret risk)
* Replacing Admin → Audit
* Billing/usage metering
* Keeping a long-term separate Admin → Status nav entry (fold into Monitoring)

## Implementation sketch

1. **Health section** — Port `/status` page into `/admin/monitoring` (or rename route); redirect `/status` → Monitoring.
2. **Read models** — SQL aggregations over `audit_events` (+ sessions) behind `GET /api/v1/admin/monitoring/*` (system admin).
3. **Optional rollup table** later if raw audit scans get slow (`monitoring_daily_stats`).
4. **UI** — Admin page: health strip first, then time-range control + cards/charts (ops clarity; sober design-system).
5. **Instrumentation gaps** — document which events already exist vs need new `action`s (`knowledge.view`, search query hash, rate_limit.exceeded).
6. **Admin sidebar** — Replace Status link with Monitoring; Audit stays adjacent.

## Privacy

* Prefer counts and ids over pasting knowledge content into the dashboard.
* Mask or omit IP in UI by default; keep in Audit for admins who need it.
* Acting-user attribution for MCP write clients must respect existing audit rules.

## Phasing

| Phase | Scope |
| --- | --- |
| **Mon-0** | **Done:** Status → Admin → Monitoring + `/status` redirect; health (`/ready` checks); MCP volume/tools/errors + active sessions; **backup stamps + export/import/download** (`GET/POST /api/v1/admin/monitoring…`) |
| **Mon-1** | **Done:** client leaderboard; top records/projects/systems (mutation audits + MCP metadata ids); embedding reindex + archived counts on Monitoring |
| **Mon-2** | `knowledge.view` / search telemetry; anomaly chips; queue strip enrichment |
| **Mon-3** | Rollup tables + longer history charts |
