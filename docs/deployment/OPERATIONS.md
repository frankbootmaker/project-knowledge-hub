# Operations & maintenance (future)

**Status:** planning backlog (not scheduled)  
**Related:** [`DOKPLOY.md`](DOKPLOY.md), [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md), [`NEXT_FEATURES.md`](../product/NEXT_FEATURES.md) (NF-005+)

This note captures **operator maintenance** work beyond the M7 packaging slice: backups, blob/object storage, DB upkeep, and day-2 tooling. Manual helpers already exist (`infrastructure/scripts/backup-db.sh`, `restore-db.sh`, migrate/seed); the goal is to turn them into a **repeatable, off-host, drillable** ops story before Prod cutover.

## Current baseline

| Capability | Today |
| --- | --- |
| Postgres dump / restore | Scripts (`pg_dump -Fc` / `pg_restore`); documented for Dev |
| Migrate / seed | Compose migrate one-shot; optional bootstrap seed (**NF-002**) |
| Health | API `GET /health`, `GET /ready`; web `/status` |
| Persistence | Named Compose volumes (Postgres; local avatar/`data` paths) |
| Redis | Cache / queues — **not** a backup source of truth |
| Secrets | Dokploy env (not included in DB dumps) |

PRD expectation: database backup and restore are **tested** before calling Prod packaging complete.

---

## Design principles

1. **Postgres is the system of record** for catalogue, knowledge, auth, audit. Redis is disposable.
2. **One `BlobStore` port** for object bytes (put / get / list / delete / optional presign). Providers plug in behind it.
3. **Backups ≠ app blobs** — use separate bucket prefixes (or buckets), e.g. `…/backups/` vs `…/app/`.
4. **S3-compatible first** for self-host and cloud (AWS S3, R2, B2, MinIO, Garage, SeaweedFS, Ceph RGW).
5. **Microsoft cloud** as first-class for Azure-centric orgs: **Azure Blob Storage** for durable objects; **OneDrive / SharePoint** (Microsoft Graph) when user/org library integration is required — not as Postgres’s home.
6. **Secrets stay out of dumps** — maintain a secrets inventory runbook (names only); restore always re-applies Dokploy/env secrets.
7. **Drill or it didn’t happen** — every backup path needs a restore checklist (empty DB → restore → migrate check → smoke login / MCP).

---

## Phased delivery

### Ops-0 — Scheduled local backup (near-term)

* Cron or Compose/worker schedule: `pg_dump -Fc` on a cadence (e.g. daily).
* Retention policy (example: 7 daily / 4 weekly / 3 monthly).
* Store dumps on a dedicated volume **on the host** first.
* Written **restore drill** in this doc’s checklist (below) + tick on Dev Dokploy.
* Land **NF-002** bootstrap seed so empty rebuilds are one-shot.

### Ops-1 — Offsite dumps

* Upload dumps to object storage via `BlobStore` (`BACKUP_OFFSITE=s3|azure_blob|…`).
* Encryption at rest (provider-managed KMS/SSE and/or client-side before upload).
* Alert when last successful backup is older than N hours.

### Ops-2 — App blob store

* Move avatars / future import documents & images / Doc Factory exports off local disk onto the same `BlobStore`.
* Env shape (illustrative): `BLOB_PROVIDER=disabled|s3|azure_blob`, endpoint/account, container/bucket, prefix, credentials.

### Ops-3 — Admin maintenance UI

* Admin “Maintenance / Ops” surface: last backup age, trigger backup, embedding reindex, purge policy knobs, migrate version, queue depth / Redis ping, disk warnings if available.
* Extends today’s `/status` rather than inventing a parallel health story.

### Ops-4 — Observability & support

* Log retention / rotation; admin log export (already deferred from M7).
* Lightweight alerting (email or webhook): backup fail, migrate fail, disk pressure, API 5xx spike.
* Redacted **support dump** (versions, health, recent errors — no secrets, no raw pastes).

---

## Blob / object storage providers

### Port: `BlobStore`

Minimal interface (implementation later):

* `put(key, body, contentType)` / `get(key)` / `delete(key)` / `list(prefix)`
* Optional `presignGet` / `presignPut` for browser uploads
* Key layout: `{env}/{purpose}/{…}` with purposes `backups`, `avatars`, `imports`, `exports`

### Provider matrix

| Provider | API | Primary use | Notes |
| --- | --- | --- | --- |
| **S3-compatible** | AWS S3 API | Backups + app blobs | Covers AWS S3, Cloudflare R2, Backblaze B2, **MinIO**, Garage, SeaweedFS, Ceph RGW. Preferred default for self-host Dev/Prod. |
| **Azure Blob Storage** | Azure SDK / REST | Backups + app blobs | First-class for Azure / Microsoft-centric deployments; same product jobs as S3, different auth (account key, SAS, or Entra ID). |
| **OneDrive / SharePoint** | Microsoft Graph | Optional **user/org library** sync or export | Folder/drive semantics, OAuth/Entra, quotas. Good for “save export to my OneDrive” or org document library; **awkward** as the only backup backend. Prefer writing durable backups to Azure Blob or S3, then optionally mirroring selected exports to OneDrive. |
| Local / disabled | Filesystem | Dev only | Current avatar path; escape hatch when no bucket is configured. |

**Decision to lock early:** implement `s3` + `azure_blob` behind one port; add `onedrive` / `sharepoint` only when a concrete user job (export destination or library sync) is approved. Do not block Ops-1 offsite backups on Graph OAuth.

---

## Database maintenance (beyond dump)

* Autovacuum / bloat awareness (FTS + `pgvector` growth); operator notes for `VACUUM (ANALYZE)` when needed.
* Migration discipline (expand/contract); never surprise-prod; backup-before-migrate gate on Prod.
* Embedding **reindex** as an admin maintenance action after embedding provider/model changes (queue already exists).
* Soft-archive **retention → hard purge** policy (schedule + confirmation); UI purge exists for humans, ops needs policy.
* Connection pool limits under Dokploy resource caps.

---

## Other ops capabilities (checklist)

| Area | Intent |
| --- | --- |
| Scheduled jobs visibility | Backups, purge, git safety sync, embedding reindex — show last run / next run |
| Admin status / ops panel | Backup age, DB migrate version, queue depth, Redis, optional disk |
| Log retention & export | Off-box or downloadable; Dokploy UI is interim |
| Alerting | Failed backup, failed migrate, disk, error budget |
| Release / rollback | Immutable image tags; last-known-good; forward-only migrations |
| TLS / domain | Dokploy/Traefik failure modes documented |
| Security ops | Session revoke, API client rotate/revoke, audit search/export (partially present) |
| Quotas | Workspace / attachment caps before object store or disk fills |
| Support dump | Redacted diagnostics package |
| Env promotion | Dev → UAT → Prod with backup-before-migrate |
| Secrets inventory | Named list of required env keys per environment (no values in git) |

---

## Restore drill (Dev → Prod gate)

Use after any backup path change:

1. Take a fresh dump (script or scheduled job).
2. Stand up empty Postgres (or restore into a disposable volume).
3. `pg_restore` from the dump; confirm migrate version matches expectations.
4. Point a throwaway API at that DB (or swap volume carefully).
5. Smoke: login, open a workspace, open a knowledge record, MCP preflight if enabled.
6. Confirm blobs (if any) resolve from the configured `BlobStore`.
7. Record date + operator in the deployment notes; do not call Prod backup “done” without this.

---

## Out of scope (for now)

* Replacing Dokploy/Traefik with a custom ingress product.
* Multi-region active-active Postgres.
* Treating OneDrive as the sole disaster-recovery store.
* Backing up Redis as primary state.

---

## Backlog IDs

See [`NEXT_FEATURES.md`](../product/NEXT_FEATURES.md):

* **NF-005** — Scheduled DB backup, retention, restore drills  
* **NF-006** — `BlobStore` + S3-compatible provider  
* **NF-007** — Azure Blob Storage + OneDrive/SharePoint (Graph) providers  
* **NF-008** — Admin maintenance / ops console  
* **NF-009** — Log export, alerting, support dump  
