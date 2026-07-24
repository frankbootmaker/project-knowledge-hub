# Operations & maintenance

**Status:** Ops-0 (scheduled local backup + export/import) **shipped**; Ops-1+ planning  
**Related:** [`DOKPLOY.md`](DOKPLOY.md), [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md), [`NEXT_FEATURES.md`](../product/NEXT_FEATURES.md) (NF-005+)

Operator maintenance beyond M7 packaging: backups, blob/object storage, DB upkeep, and day-2 tooling. **Ops-0** is live on Dokploy Compose (`db-backup` service + scripts). Offsite upload and Admin Monitoring UI follow in later waves.

## Current baseline

| Capability | Today |
| --- | --- |
| Postgres dump / restore | Scripts + Compose `db-backup` (`pg_dump -Fc` / `pg_restore`); retention + stamps |
| Export / import | `export-db.sh` / `import-db.sh` (full replace; cross-instance OK) |
| Migrate / seed | Compose migrate one-shot; optional bootstrap seed (**NF-002**) |
| Health | API `GET /health`, `GET /ready`; web `/status` (→ Monitoring in **NF-011**) |
| Persistence | Named Compose volumes (Postgres; `knowledge_hub_backups`; local avatar/`data`) |
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

### Ops-0 — Scheduled local backup + export/import path — **done**

* Compose service `db-backup` (Dokploy) / optional local `compose.yaml` profile `backup`: loop `pg_dump -Fc` on an interval (default `BACKUP_INTERVAL_SECONDS=86400`). Admin → Monitoring can override enable/interval via `BACKUP_DIR/schedule.json` (sidecar re-reads each cycle).
* Retention via `rotate-backups.sh` / Admin `retention.json`: `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` (defaults 7 / 4 / 3).
* Dumps on named volume `knowledge_hub_backups` (path `/backups` in the sidecar).
* Volume ownership: API/worker use uid **1001**; `db-backup` and container entrypoints chown `/backups` so Monitoring export/delete work.
* **Export:** `export-db.sh` (= `backup-db.sh`); artifacts `knowledge-hub-*.dump`, symlink `latest.dump`.
* **Import:** `import-db.sh` with `CONFIRM_IMPORT=REPLACE` (optional `WIPE_DATABASE=1`) → `pg_restore`; stamps for Monitoring (**NF-011**).
* Stamps: `/backups/last-success.json` (backup), `/backups/last-import.json` (import) — `kind`, `at`, `artifact`, `schemaVersion` (drizzle migration max id).
* **Restore / import drill** checklist below; run on Dev after deploy.
* **NF-002** bootstrap seed remains optional for empty rebuilds (import may replace seed).

### Ops-1 — Offsite dumps — **done** (S3-compatible)

* `BLOB_PROVIDER=s3` + bucket/credentials; objects at `{BLOB_KEY_PREFIX|APP_ENV}/backups/…`.
* After API **Export now**, dump is uploaded when `BACKUP_OFFSITE=true` (default).
* Worker sync (same backup volume) uploads pending `last-success` dumps on an interval (`BACKUP_OFFSITE_SYNC_INTERVAL_MS`).
* Stamp: `/backups/last-offsite.json`; Monitoring shows last offsite age + **Push offsite** per file.
* Provider-managed encryption at rest (bucket SSE/KMS) — client-side encrypt later if needed.
* Azure Blob (`NF-007`) on Admin → **Storage** when **Entra ID** sign-in (`NF-012`) lands.

### Ops-2 — App blob store (avatars + knowledge media) — **done** (S3 + local fallback)

* Profile avatars use `BlobStore` when `BLOB_PROVIDER=s3` (keys `{prefix}/avatars/{userId}`); served via `/api/v1/avatars/:userId` (no public S3 URLs).
* When provider is `disabled`, avatars stay on `AVATAR_UPLOAD_DIR` (Compose volume). Local file is used as read fallback and optional backfill when migrating to S3.
* **Knowledge media (NF-013):** workspace library JPEG/PNG/WebP at `{prefix}/media/{workspaceId}/{mediaId}`; embed via `/api/v1/media/:mediaId` (auth). Local fallback `MEDIA_UPLOAD_DIR`. MCP `upload_workspace_media` returns a Markdown snippet.
* Document/import file pipelines and Doc Factory exports still later.

### Ops-3 — Admin maintenance UI

* Admin “Maintenance / Ops” (or Monitoring health section): last backup age, **trigger export**, **upload/import dump** (dangerous; confirm), embedding reindex, purge policy knobs, migrate version, queue depth / Redis ping.
* Extends today’s Status health strip (folded into **Admin → Monitoring**, **NF-011**) rather than inventing a second health story.

### Ops-4 — Observability & support

* **Light v1 (NF-009):** Admin → Monitoring **Download support dump** (`GET /api/v1/admin/monitoring/support-dump`) — redacted JSON (env label, schema, ready checks, backup ages, MCP error counts, pending attention, recent error audit ids/actions; **no** secrets or pastes). Stale-backup attention chip when `last-success` age exceeds `BACKUP_STALE_AFTER_HOURS` (default 36).
* Follow-on: log retention / rotation; admin log export (M7 deferred); webhook/email alerts for backup fail, migrate fail, disk pressure, API 5xx spike.

---

## Blob / object storage providers

### Port: `BlobStore`

Minimal interface (implementation later):

* `put(key, body, contentType)` / `get(key)` / `delete(key)` / `list(prefix)`
* Optional `presignGet` / `presignPut` for browser uploads
* Key layout: `{env}/{purpose}/{…}` with purposes `backups`, `avatars`, `media`, `imports`, `exports`

### Provider matrix

| Provider | API | Primary use | Notes |
| --- | --- | --- | --- |
| **S3-compatible** | AWS S3 API | Backups + app blobs | Covers AWS S3, Cloudflare R2, Backblaze B2, **MinIO**, Garage, SeaweedFS, Ceph RGW. Preferred default for self-host Dev/Prod. |
| **Azure Blob Storage** | Azure SDK / REST | Backups + app blobs | Same Admin → Storage UI as S3. **Ship with Entra IdP** (NF-012); account key / SAS only as escape hatch. |
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
| Admin status / ops panel | **Admin → Monitoring** (health, backup age, export/import); Audit remains the event stream |
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

## Ops-0 runbook (scripts)

| Job | Command |
| --- | --- |
| Manual export / backup | `POSTGRES_CONTAINER=… POSTGRES_PASSWORD=… ./infrastructure/scripts/export-db.sh` |
| Or TCP (sidecar-style) | `POSTGRES_HOST=127.0.0.1 POSTGRES_PASSWORD=… BACKUP_DIR=./backups ./infrastructure/scripts/backup-db.sh` |
| Retention only | `BACKUP_DIR=./backups ./infrastructure/scripts/rotate-backups.sh` |
| Import (replace) | `CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 POSTGRES_CONTAINER=… ./infrastructure/scripts/import-db.sh ./backups/latest.dump` |
| Low-level restore | `./infrastructure/scripts/restore-db.sh ./backups/foo.dump` (prefer `import-db.sh`) |

Local optional scheduler:

```bash
docker compose --profile backup up -d db-backup
```

Dokploy: `db-backup` is always defined in `compose.dokploy.yaml`; set `BACKUP_ENABLED=false` to idle without dumping.

### Env knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `BACKUP_ENABLED` | `true` | Sidecar dumps when true; Admin can toggle via Monitoring (`schedule.json`) |
| `BACKUP_INTERVAL_SECONDS` | `86400` | Seconds between dumps (≥ 60); Admin presets override via `schedule.json` |
| `BACKUP_KEEP_DAILY` | `7` | Keep all dumps younger than N days |
| `BACKUP_KEEP_WEEKLY` | `4` | Then keep ≤N one-per-ISO-week |
| `BACKUP_KEEP_MONTHLY` | `3` | Then keep ≤N one-per-month; older deleted |
| `BACKUP_RUN_ON_START` | `1` | Dump once when sidecar starts |
| `BACKUP_DIR` | `./backups` or `/backups` | Artifact + stamp directory |

---

## Restore / import drill (Dev → Prod gate)

Use after any backup path change, and when validating **cross-instance** import:

1. Take a fresh dump on the **source** (`export-db.sh` or wait for `db-backup`) — this is the **export**. Confirm `last-success.json`.
2. Stand up empty Postgres on the **target** (same or other KnowHub) — or use `WIPE_DATABASE=1`.
3. **Import:** `CONFIRM_IMPORT=REPLACE … ./infrastructure/scripts/import-db.sh <dump>`; confirm `schemaVersion` / run migrate if dump is older than the app.
4. Point API at that DB; re-apply **target** env secrets / `WEB_URL` (do not copy source secrets blindly).
5. Smoke: login, open a workspace, open a knowledge record, MCP preflight if enabled.
6. If using blobs: confirm object store keys resolve (or accept missing avatars until blob sync).
7. Confirm `last-import.json`; record date + operator + source→target in deployment notes; do not call Prod backup “done” without this.

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
