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
8. **Export/import is first-class** — the same dump format supports disaster recovery **and** moving data between environments/instances (Dev ↔ UAT ↔ Prod, or laptop ↔ Dokploy), with explicit schema-version and secrets rules.

---

## Database export / import (data mobility)

Treat “backup” as a **portable Postgres custom-format dump** (`pg_dump -Fc`) that can be:

| Job | Export | Import |
| --- | --- | --- |
| **Disaster recovery** | Scheduled dump of this instance | Restore onto empty/replaced DB for *this* deployment |
| **Clone / promote** | Dump from source env | Import into a **different** KnowHub instance (e.g. Prod → Dev refresh, Dev → new UAT) |
| **Move house** | Dump + optional blob/object sync | New host restores DB; re-apply secrets; re-point `WEB_URL` / MCP URLs |

### Format and tooling

* **Canonical artifact:** `pg_dump -Fc` (already used by `backup-db.sh`).
* **Import:** `pg_restore` into a target database (prefer **empty** DB or dedicated restore volume; document replace-vs-merge — v1 is **replace/full restore**, not merge).
* **Admin UI (later, with NF-008):** “Download export” / “Upload import” with strong confirmations (typed phrase), progress, and post-import migrate check.
* **CLI remains the Ops-0 path:** scripts + Dokploy run/SSH until the UI exists.

### Cross-system import rules

Importing a dump from **another** KnowHub (or another env of the same product) is supported as a goal, with guardrails:

1. **Schema compatibility** — dump’s migration version must be ≤ target app version; run migrate after restore if behind; **refuse or warn** if dump is newer than the running app.
2. **Full replace in v1** — do not silently merge two live databases (ID collisions, unique emails/slugs). Operator chooses: wipe target DB → restore dump.
3. **Secrets are not in the dump** — `SESSION_SECRET`, mail keys, embedding keys, blob credentials stay in Dokploy/env; after import, sessions and some tokens may be invalid until users re-login; API client **token hashes** restore but operators must know which clients exist.
4. **URLs / public identity** — update `WEB_URL`, `MCP_PUBLIC_URL`, cookie domain after moving hosts.
5. **Blobs / avatars** — DB rows may reference object keys; without copying the blob bucket/prefix, avatars and future file attachments break. Pair DB import with blob sync when `BlobStore` is in use (**NF-006**).
6. **Embeddings** — large `pgvector` data comes along in a full dump; optional later “dump without embeddings + reindex” for smaller transfers.
7. **PII / audit** — a full dump includes users, audit events, and knowledge content; treat exports as **sensitive** (encrypt at rest, access-controlled storage).

### Selective mobility (future)

Workspace- or project-scoped export/import (move one tenant without cloning the whole platform) is **out of Ops-0**. Track as a follow-on once full-dump mobility works — rewrite IDs, memberships, and provenance carefully. Until then, “move data around” means **instance-level** dump/restore.

---

## Phased delivery

### Ops-0 — Scheduled local backup + export/import path (near-term)

* Cron or Compose/worker schedule: `pg_dump -Fc` on a cadence (e.g. daily).
* Retention policy (example: 7 daily / 4 weekly / 3 monthly).
* Store dumps on a dedicated volume **on the host** first.
* **Export:** copy/download the dump artifact (script path + documented location; later Admin download).
* **Import:** documented `pg_restore` into empty target (same or **other** instance) + migrate check + smoke; write last-success stamp for Monitoring (**NF-011**).
* Written **restore / import drill** in this doc’s checklist (below) + tick on Dev Dokploy.
* Land **NF-002** bootstrap seed so empty rebuilds are one-shot (import may replace seed).

### Ops-1 — Offsite dumps

* Upload dumps to object storage via `BlobStore` (`BACKUP_OFFSITE=s3|azure_blob|…`).
* Encryption at rest (provider-managed KMS/SSE and/or client-side before upload).
* Alert when last successful backup is older than N hours.
* Offsite object becomes the **exchange format** for moving dumps between systems (download on target → import).

### Ops-2 — App blob store

* Move avatars / future import documents & images / Doc Factory exports off local disk onto the same `BlobStore`.
* Env shape (illustrative): `BLOB_PROVIDER=disabled|s3|azure_blob`, endpoint/account, container/bucket, prefix, credentials.
* Document **DB + blob** paired transfer for cross-system moves.

### Ops-3 — Admin maintenance UI

* Admin “Maintenance / Ops” (or Monitoring health section): last backup age, **trigger export**, **upload/import dump** (dangerous; confirm), embedding reindex, purge policy knobs, migrate version, queue depth / Redis ping.
* Extends today’s Status health strip (folded into **Admin → Monitoring**, **NF-011**) rather than inventing a second health story.

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

## Restore / import drill (Dev → Prod gate)

Use after any backup path change, and when validating **cross-instance** import:

1. Take a fresh dump on the **source** (script or scheduled job) — this is the **export**.
2. Stand up empty Postgres on the **target** (same or other KnowHub) — or restore into a disposable volume.
3. **Import** with `pg_restore`; confirm migrate version (migrate forward if dump is older).
4. Point API at that DB; re-apply target env secrets / `WEB_URL` (do not copy source secrets blindly).
5. Smoke: login, open a workspace, open a knowledge record, MCP preflight if enabled.
6. If using blobs: confirm object store keys resolve (or accept missing avatars until blob sync).
7. Record date + operator + source→target in deployment notes; do not call Prod backup “done” without this.

---

## Out of scope (for now)

* Replacing Dokploy/Traefik with a custom ingress product.
* Multi-region active-active Postgres.
* Treating OneDrive as the sole disaster-recovery store.
* Backing up Redis as primary state.
* **Merge-import** of two live databases or selective workspace transplant (follow-on after full-dump mobility).

---

## Backlog IDs

See [`NEXT_FEATURES.md`](../product/NEXT_FEATURES.md):

* **NF-005** — Scheduled DB backup, export/import (incl. cross-instance), retention, restore drills  
* **NF-006** — `BlobStore` + S3-compatible provider  
* **NF-007** — Azure Blob Storage + OneDrive/SharePoint (Graph) providers  
* **NF-008** — Admin maintenance / ops console (trigger export, upload import)  
* **NF-009** — Log export, alerting, support dump  
* **NF-011** — Admin monitoring (last backup / last import stamps)  
