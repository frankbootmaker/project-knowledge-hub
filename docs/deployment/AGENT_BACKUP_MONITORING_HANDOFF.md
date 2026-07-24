# Agent handoff: Dokploy backup, monitoring, and DB transfer

**Audience:** Another Cursor agent (or operator) standing up the same backup/monitoring pattern on another site, especially to move data between **local development** and a **Dokploy** instance.

**Reference implementation:** this repo (`project-knowledge-hub`). Prefer copying patterns and scripts over reinventing.

**Primary docs already in-tree:**

| Doc | Role |
| --- | --- |
| [`DOKPLOY.md`](./DOKPLOY.md) | Compose layout, env matrix, seed/migrate, recovery |
| [`OPERATIONS.md`](./OPERATIONS.md) | Ops-0/1 backup, export/import rules, retention |
| [`.env.dokploy.example`](../../.env.dokploy.example) | Env template (no secrets) |
| [`compose.dokploy.yaml`](../../compose.dokploy.yaml) | Canonical Dokploy stack |

---

## 1. Goal

Ship:

1. **Scheduled Postgres dumps** (`pg_dump -Fc`) on a named volume  
2. **Admin Monitoring** — health, backup age, export / download / import  
3. **Bidirectional data move:** local ↔ Dokploy (full DB replace, not merge)

Non-goals for v1: tenant-scoped export, merge of two live DBs, putting secrets inside dumps.

---

## 2. Architecture to copy

```text
Browser ──HTTPS──► web
                      │  rewrites /api/v1 → api (Compose DNS)
api / worker ──────► postgres (pgvector) + redis
db-backup ─────────► same postgres; writes /backups volume
api mounts same volume → Admin Monitoring export/import/download
```

**Must-haves:**

| Piece | Why |
| --- | --- |
| `pgvector/pgvector:pg16` (or matching PG major) | Schema + `pg_dump` client major must match |
| Shared volume `…_backups` → `/backups` on `api` + `db-backup` | Monitoring UI and sidecar see the same dumps |
| API image ships **matching** `postgresql-client-N` | Debian default client often lags (e.g. 15 vs PG 16) → `pg_dump` refuses |
| API/worker run as fixed uid (here **1001**); chown `/backups` on start | Sidecar dumps as root otherwise → Monitoring export/delete `EACCES` |
| Migrate one-shot before api/worker; seed after migrate | Redeploy stays idempotent |
| Discrete `POSTGRES_PASSWORD` + encode when building URL | Passwords with `&` `#` `@` break Compose-concatenated `DATABASE_URL` |

---

## 3. Hard-won Dokploy learnings

### Networking / Monitoring “red” while the site works

- **Browser** calls `/api/v1/…` via Next **rewrites** baked at image build (`NEXT_REWRITE_API_ORIGIN=http://api:3101`).
- **SSR** (Monitoring page load) uses **runtime** `API_URL` inside the web container.
- If Dokploy Environment sets `API_URL=http://localhost:3101`, SSR fails → fake “postgres/redis error” or `unknown` + load-error banner, while client Refresh / support dump still works.
- **Fix:** web runtime `API_URL=http://api:3101`. Never put laptop `localhost` API URLs in Dokploy. Prefer a dedicated build arg (`NEXT_REWRITE_API_ORIGIN`) so Dokploy cannot poison the image build.

### Env / seed / migrate

- Put secrets on the **Compose service Environment** tab (not only project-level). Compose interpolates from the `.env` Dokploy writes beside the compose file.
- Omit empty optional vars (`SMTP_HOST=`). Empty strings fail Zod/`min(1)`.
- Postgres volume keeps the password from **first init**. Changing `POSTGRES_PASSWORD` in env alone → `28P01 password authentication failed`. Fix: restore original password **or** `ALTER USER … WITH PASSWORD '…'` (use a heredoc so bash does not treat `&` as background).
- Prefer alphanumeric passwords, or pass `POSTGRES_PASSWORD` as its own env var and **percent-encode** when building `DATABASE_URL` in app code (see `packages/config/src/database-url.ts`).
- Seed should not call full app `loadEnv()` if optional mail/blob knobs can fail the one-shot and block api/web (`depends_on: seed: service_completed_successfully`). Seed only needs DB + org/bootstrap vars; skip invalid bootstrap with a warning.

### Build / deploy

- Give migrate **no** `build:` — reuse `image: …-api:dokploy` so you do not OOM on small hosts with three parallel Dockerfile builds.
- Limit Turbo concurrency in Docker builds when api/web/worker build in parallel.
- After a bad DB import, **redeploy alone is not enough** if migrate exits non-zero — api/web never start. Restore a known-good dump first, then redeploy.

### Monitoring UX honesty

- If the web cannot load monitoring from the API, show **`unknown` + explicit `loadError`**, not fake `postgres: error` / `redis: error`. Otherwise operators chase the wrong dependency.

---

## 4. Data transfer: local ↔ Dokploy

**Model:** instance-level **full replace**. Artifact = `pg_dump -Fc` (`.dump`). Secrets stay in env; after import, log in with users from the **imported** dump.

### A. Local → Dokploy (promote / seed remote with laptop data)

1. **Export locally** (Postgres reachable; same major as remote preferred):

   ```bash
   # Against local Compose postgres container:
   export POSTGRES_CONTAINER=<local-postgres-container>
   export POSTGRES_USER=knowledge_hub
   export POSTGRES_DB=knowledge_hub
   export POSTGRES_PASSWORD='…'
   ./infrastructure/scripts/export-db.sh
   # → ./backups/knowledge-hub-….dump  (+ last-success.json, latest.dump)
   ```

2. **Copy dump to Dokploy** (pick one):
   - Admin → Monitoring → **Import** → upload `.dump` (type `REPLACE`)
   - Or `docker cp` / volume browser into `/backups` on `db-backup` or `api`
   - Or SCP to host then into the volume

3. **Import on Dokploy** (if not using UI):

   ```bash
   # From db-backup container (has /backups + /scripts):
   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
     POSTGRES_PASSWORD='…' \
     /scripts/dokploy-recover-db.sh /backups/knowledge-hub-….dump
   # or: /scripts/import-db.sh …
   ```

4. **Restart api + worker** (UI import already terminates sessions and restarts API). Redeploy if migrate/api did not come back.
5. Smoke: login with an account from the dump; set/confirm `WEB_URL` / mail / blob secrets for **this** environment.

### B. Dokploy → local (pull production-ish data for debugging)

1. **Export on Dokploy:**
   - Admin → Monitoring → **Export now** → **Download**, or
   - Wait for `db-backup` cycle / copy `/backups/knowledge-hub-*.dump` off the volume

2. **Import locally** (destroys local DB contents):

   ```bash
   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
     POSTGRES_CONTAINER=<local-postgres> POSTGRES_PASSWORD='…' \
     ./infrastructure/scripts/import-db.sh ./backups/from-dokploy.dump
   ```

3. Run migrate if the dump’s schema is behind local app: `./infrastructure/scripts/migrate.sh`
4. Point local `.env` `DATABASE_URL` at local Postgres; do **not** overwrite Dokploy secrets into git.
5. Smoke login with dump users.

### C. Safety checklist (every transfer)

- [ ] Dump schema version ≤ target app version (migrate after if dump is older; **do not** import a newer dump into an older app without upgrading the app first)
- [ ] Typed confirm `REPLACE` / `CONFIRM_IMPORT=REPLACE`
- [ ] Target secrets re-applied (`SESSION_SECRET`, mail, blob) — dump does not carry them
- [ ] `WEB_URL` / MCP URLs match the **target** host
- [ ] Treat dumps as **sensitive** (users, audit, knowledge content)
- [ ] Keep one known-good dump before overwriting Dokploy

---

## 5. Scripts and UI surface to reuse

| Path | Purpose |
| --- | --- |
| `infrastructure/scripts/backup-db.sh` / `export-db.sh` | Dump + stamp + rotate |
| `infrastructure/scripts/import-db.sh` | Full replace restore |
| `infrastructure/scripts/backup-loop.sh` | Sidecar schedule loop |
| `infrastructure/scripts/dokploy-recover-db.sh` | In-cluster recovery helper |
| `infrastructure/scripts/rotate-backups.sh` | 7d / 4w / 3m retention |
| Admin → Monitoring | Export / download / import / schedule / retention / support dump |
| `GET /api/v1/admin/monitoring/support-dump` | Redacted JSON for support (no secrets) |

Compose knobs (Dokploy): `BACKUP_ENABLED`, `BACKUP_INTERVAL_SECONDS`, `BACKUP_KEEP_*`, `BACKUP_DIR=/backups`, optional S3 offsite via `BLOB_PROVIDER=s3`.

---

## 6. Minimal porting checklist for another site

1. **Postgres** in Compose (private network; pgvector if needed).  
2. **`db-backup` sidecar** + named volume; mount scripts read-only.  
3. **API** mounts same volume; install matching `postgresql-client`; chown backups on entrypoint.  
4. **Admin Monitoring** (or equivalent): health checks, last-success age, export/import with `REPLACE` confirm.  
5. **Web SSR `API_URL`** = Compose service URL (`http://api:…`), not localhost.  
6. **Discrete `POSTGRES_PASSWORD`** + encoded URL builder.  
7. Document **local ↔ remote** dump transfer (sections 4A/4B above) in that project’s runbook.  
8. Drill once: export local → import Dokploy → login; then reverse.

---

## 7. Quick diagnosis cheatsheet

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Monitoring unknown / loadError; dump download works | Web `API_URL=localhost` | Set `http://api:3101` on web |
| `28P01` on seed/migrate | Env password ≠ volume / special chars in URL | `ALTER USER` or encode URL; align env |
| `seed` exit 1 blocks api/web | Full `loadEnv` / bad bootstrap | Soft seed; see DOKPLOY troubleshooting |
| Export fails / EACCES | Root-owned `/backups` | chown uid of API user |
| `pg_dump` version mismatch | Client 15 vs server 16 | Install client 16 in API image |
| Site down after import | Migrate failed / pools dead | Restore good dump; redeploy; restart api/worker |

---

## 8. Suggested first message for the other agent

> Port KnowHub’s Dokploy Ops-0 backup + Monitoring DB transfer to this project.  
> Reuse patterns from `project-knowledge-hub`: `compose.dokploy.yaml` `db-backup` + shared backups volume, `infrastructure/scripts/{export,import,backup-loop,dokploy-recover}-db.sh`, Admin Monitoring export/import with `REPLACE`, matching postgresql-client, backup volume chown, SSR `API_URL` = Compose DNS (never localhost).  
> Priority: bidirectional **local ↔ Dokploy** full-replace dump workflow. Read `docs/deployment/AGENT_BACKUP_MONITORING_HANDOFF.md` and `OPERATIONS.md` / `DOKPLOY.md` before coding. Do not put secrets in dumps; do not invent merge imports.
