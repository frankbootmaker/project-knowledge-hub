# Dokploy Deployment (Dev/UAT)

**Status:** Milestone 7 — Dev/UAT packaging (first slice)  
**Compose entrypoint:** [`compose.dokploy.yaml`](../../compose.dokploy.yaml)  
**Env template:** [`.env.dokploy.example`](../../.env.dokploy.example)  
**Git branch for Dev:** `feature/m7-dokploy` (ongoing M7 work). Promote Dev-proven slices to `master` via PR — see [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md).

## Parallel `feature/new-design` preview

This branch’s Compose file is **not** the live KnowHub stack. On the same Dokploy host, create a **new** Compose service (new project or new app), point Git at `feature/new-design`, and attach domains to **`nd-web`** (port **3100**), not `web`.

All identifiers are prefixed so they cannot collide with live KnowHub:

| Kind | Live stack | This preview |
| --- | --- | --- |
| Public services on `dokploy-network` | `web`, `api` | `nd-web`, `nd-api` |
| DB / Redis / MarkItDown | `kh-postgres`, `kh-redis`, `kh-markitdown` | `nd-postgres`, `nd-redis`, `nd-markitdown` |
| Image tags | `knowledge-hub-*:dokploy` | `knowledge-hub-*:dokploy-nd` |
| Container names | Dokploy project prefix | `kh-nd-*` |
| Volumes | `knowledge_hub_*` | `nd_knowledge_hub_*` |
| Blob prefix (shared bucket) | (unset / live) | `new-design/` |

Use a **different** `WEB_URL`, `SESSION_SECRET`, and `POSTGRES_PASSWORD` than live. Traefik/OIDC callback must match the preview domain.

Production cutover and registry automation are **out of scope** for this slice. Admin ops log export lives on Monitoring (`ops-log-export`); raw container stdout remains in the Dokploy UI.

## Architecture

```text
Browser ──HTTPS──► nd-web:3100
                      │  Next rewrites (baked at image build)
                      ├── /api/v1/* ──► nd-api:3101
                      └── /mcp      ──► nd-api:3101
nd-api / nd-worker ──► nd-postgres (pgvector/pgvector:pg16)
nd-api / nd-worker ──► nd-redis
```

* Public traffic should hit **only the nd-web** origin (`WEB_URL`).
* Next rewrites are baked at **web image build** via `NEXT_REWRITE_API_ORIGIN=http://nd-api:3101`.  
  **Never** set `API_URL=http://localhost:3101` (or `127.0.0.1`) in Dokploy env — that value is for laptop `pnpm dev` only and will make `/api/v1` proxy to the web container itself (`ECONNREFUSED 127.0.0.1:3101`).
* Postgres and Redis are **not** published to the host in `compose.dokploy.yaml` (Compose network only).
* Set public `WEB_URL=https://<dev-domain>` at runtime for cookies, mail links, and AI discover.
* Optional `MCP_PUBLIC_URL=https://<dev-domain>/mcp` (same-origin via web rewrite).

## Images

| Service | Dockerfile | Image tag |
| --- | --- | --- |
| nd-api (+ nd-migrate one-shot reuses this image) | `infrastructure/docker/api.Dockerfile` | `knowledge-hub-api:dokploy-nd` |
| nd-worker | `infrastructure/docker/worker.Dockerfile` | `knowledge-hub-worker:dokploy-nd` |
| nd-web | `infrastructure/docker/web.Dockerfile` (`ARG NEXT_REWRITE_API_ORIGIN`) | `knowledge-hub-web:dokploy-nd` |

`nd-migrate` has **no** `build:` — only `image: knowledge-hub-api:dokploy-nd` + `pull_policy: never`, so Compose builds the API Dockerfile once (via `nd-api`), then runs migrate from that tag.

Build validation (local):

```bash
docker compose -f compose.dokploy.yaml --env-file .env.dokploy.example config
docker compose -f compose.dokploy.yaml --env-file .env.dokploy.example build
```

Or with the local overlay profile:

```bash
docker compose -f compose.yaml -f compose.production.yaml --profile full build
```

## Environment matrix

| Variable | Where | Notes |
| --- | --- | --- |
| `WEB_URL` | runtime | Public HTTPS origin |
| (web rewrite target) | **build** (nd-web) | Hardcoded `http://nd-api:3101` — do not override with localhost |
| `POSTGRES_*` | runtime | Compose builds `DATABASE_URL` via host `nd-postgres` |
| (Redis) | runtime | Fixed `redis://nd-redis:6379` on the Compose network |
| `SESSION_SECRET` | runtime | Long random secret |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | runtime | Authentik (or generic OIDC) **env fallback**. Prefer **Admin → SSO** to save issuer/client/secret/JIT (applies on next login, no redeploy). Env still works if the Admin override is absent. Set all three to enable SSO; omit or leave empty to hide the button unless Admin SSO is complete. Optional: `OIDC_BUTTON_LABEL`, `OIDC_IDP_SOURCE=authentik`, `OIDC_REDIRECT_URI` (default `{WEB_URL}/api/v1/auth/oidc/callback`), `OIDC_JIT_PROVISIONING=true` (create active users on first verified-email SSO; default `false`) |
| `APP_ENV` | runtime | Use `staging` for Dev/UAT |
| `NODE_ENV` | runtime | Always `production` in containers |
| `MCP_PUBLIC_URL` | runtime | Optional; prefer `https://<domain>/mcp` |
| `EMBEDDING_PROVIDER` | runtime | Default `disabled` (FTS only) |
| `MAIL_DRIVER` | runtime | `console` (default), `smtp`, or `resend` (Resend / Freeresend-compatible) |
| `SMTP_*` / `RESEND_API_KEY` / `RESEND_BASE_URL` / `MCP_PUBLIC_URL` | runtime | Set only when used — omit empty values. `RESEND_BASE_URL` optional (default `https://api.resend.com`) |
| `BOOTSTRAP_ADMIN_*` | migrate one-shot (seed step) | Optional first admin |
| `MARKITDOWN_URL` | runtime | Default `http://nd-markitdown:8080` (document/image import) |
| `VISION_LLM_*` | runtime + `nd-markitdown` | Optional env fallback for vision OCR / AI translation when Admin → AI providers has no binding for that service |

**Warnings**

* Do not bake host `.env` with `NODE_ENV=development` into image builds — Dockerfiles force `NODE_ENV=production` during `pnpm build`.
* Use **pgvector** Postgres (`pgvector/pgvector:pg16`). Plain Postgres 16 will fail migration `0020`.
* Never commit real secrets; configure them in Dokploy.
* Do not export empty optional env vars into containers (`SMTP_HOST=` fails validation).

## Dokploy 0.29+ UI notes

1. Create a **Project**, then **Create Service → Compose** (one service for the whole stack).
2. Set Compose file path to `compose.dokploy.yaml`.
3. Put required env vars on the **Compose service Environment** tab (`KEY=value`).  
   **Project-level Environment alone is not enough** — Compose interpolates from the `.env` Dokploy writes next to the compose file, which is fed by the service Environment. Missing `WEB_URL` / `POSTGRES_PASSWORD` fails before containers start.
4. Point a domain at the **nd-web** service (port **3100**); enable HTTPS.
5. Set `WEB_URL` to that HTTPS origin. Do not expose Postgres or Redis.

**AI translation / long LLM calls return non-JSON / `Internal Server Error` in the browser:** the UI expected JSON but got HTML, empty body, or plain-text `Internal Server Error`. Two common causes while the API waits on the model (often 60–120s+ for local Ollama):

1. **Next.js rewrite proxy** defaults to **30s** (`experimental.proxyTimeout`). KnowHub sets this to **600s** in `apps/web/next.config.mts` — rebuild/redeploy **nd-web** after pulling that change. Local `pnpm run dev` must restart so Next reloads the config.
2. **Traefik gateway timeout** (default ~60s). Raise entrypoint timeouts on the Dokploy host (`/etc/dokploy/traefik/traefik.yml`), then reload Traefik:

```yaml
entryPoints:
  web:
    transport:
      respondingTimeouts:
        readTimeout: 0s
        writeTimeout: 0s
        idleTimeout: 180s
  websecure:
    transport:
      respondingTimeouts:
        readTimeout: 0s
        writeTimeout: 0s
        idleTimeout: 180s
```

Also confirm **Admin → AI Providers** has an active Translation binding whose **base URL** is an OpenAI-compatible root ending in `/v1` (e.g. `https://api.openai.com/v1`), not an HTML status page. Set the provider **Timeout (ms)** high enough for long docs (e.g. `300000`). Workaround without AI: create the sibling translation without “Translate with AI”, then edit title/body manually.

**Manage → Add translation** uses `POST /api/v1/knowledge-records/:id/translations/stream` (SSE) for staged progress and optional live model Details. That stream still goes through the Next rewrite (`proxyTimeout: 600s`) and Traefik — the same timeout guidance above applies. MCP/OpenAPI keep the non-streaming JSON `POST .../translations`.

**Networking:** Only `nd-web` and `nd-api` join external `dokploy-network` (Traefik). Postgres/Redis/worker/db-backup/`nd-markitdown` stay on the project `default` network with unique hostnames (`nd-postgres`, `nd-redis`, `nd-markitdown`). If `/api/v1/*` returns a plain-text `Internal Server Error` while `/login` works, `nd-web` cannot reach `nd-api`. Redeploy after pulling this compose, or on the Dokploy host temporarily:

```bash
# Inspect which networks each container has, then bridge them, e.g.:
docker network connect <preview-project>_default kh-nd-web
# and/or:
docker network connect dokploy-network kh-nd-api
```

**Build dies mid-turbo with no TypeScript error:** almost always **host RAM**. Symptoms: log stops during `tsc` / Next compile; Dokploy shows cancelled/stuck “running”. Mitigations in this repo:

1. `nd-migrate` **reuses** `knowledge-hub-api:dokploy-nd` (no second `api.Dockerfile` build).
2. Dockerfiles use `turbo ... --concurrency=1` to cut peak memory **inside** each image build.
3. Compose still builds **api + web + worker in parallel**. On a small VPS, serialize them on the Dokploy host before deploy:

   ```bash
   # On the Dokploy server (SSH), once — or export in the environment that runs compose:
   export COMPOSE_PARALLEL_LIMIT=1
   ```

   Or temporarily stop other heavy containers, free RAM (`free -h`), then Redeploy. If the queue is stuck after an OOM, clear it in Dokploy Settings and/or restart the Dokploy service.

**Slow deploys (cold vs warm):** first build after a prune is heavy (Chromium + ffmpeg/tesseract apt, triple `pnpm install`, Next compile). Dockerfiles are layered so **later deploys stay warm**:

1. **Manifest-first install** — only `package.json` / lockfile are copied before `pnpm install`, so app source edits do not re-download 791 packages.
2. **Shared BuildKit `pnpm-store` cache** — api/web/worker reuse the same download store across parallel builds.
3. **Per-image Turbo cache mounts** — package `tsc` / Next outputs reuse across redeploys when BuildKit cache is intact.
4. **Chromium apt in its own stage** — code-only api rebuilds skip the ~2–3 min Chromium install when that layer is still cached.

Do **not** prune Docker build cache on the Dokploy host between routine deploys (`docker builder prune`) if you care about speed. Dependency bumps (`pnpm-lock.yaml`) still force a fresh install layer; that is expected.

## Deploy order

1. **Build** api, worker, web images.
2. **Start** postgres + redis; wait until healthy.
3. **Migrate + seed** — Compose `migrate` one-shot uses entrypoint `/migrate-and-seed.sh` on the api image (`service_completed_successfully` before api/worker). Combined on purpose: a separate `seed` service often received a different `POSTGRES_PASSWORD` from Dokploy env injection (migrate OK, seed `28P01`). Seed failure is **non-fatal** (logged as WARN) so a bootstrap hiccup cannot block api/worker after migrations succeed.  
   Manual / Dokploy “Run command” on the api image:

   ```bash
   /migrate-and-seed.sh
   # or:
   node node_modules/tsx/dist/cli.mjs packages/database/src/migrate.ts
   node node_modules/tsx/dist/cli.mjs packages/database/src/seed.ts
   ```

   Or from a checkout with deps: `DATABASE_URL=... ./infrastructure/scripts/migrate.sh`
4. **Seed (NF-002)** — Runs at the end of the migrate one-shot. Creates default org; creates system admin when `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` (min 12) are set. Idempotent if admin already exists; no-op when bootstrap vars are unset or invalid (warns and continues so redeploys are not blocked).
5. **Start** api, worker, web.

## Smoke checklist

After deploy:

* [ ] `https://<domain>/` loads the web app
* [ ] `https://<domain>/api/v1/...` reaches the API via rewrite (e.g. login)
* [ ] API health via internal checks / Dokploy: `/health` and `/ready` on api
* [ ] Login (or bootstrap admin after seed)
* [ ] MCP over HTTPS: `https://<domain>/mcp` (or configured `MCP_PUBLIC_URL`)
* [ ] Restart stack; Postgres data persists (named volume)
* [ ] Worker is running (git sync / embedding queues idle is OK)

## Troubleshooting

### Login 403 `Request origin is not allowed`

CSRF compares the browser `Origin` to `WEB_URL`. On the preview app this is almost always a copied live `WEB_URL` or a Dokploy hostname that is not the URL in the address bar.

1. Copy the origin from the browser (scheme + host only, e.g. `https://knowhub-design.example.com`).
2. Set that exact value as **`WEB_URL`** on the Compose **service** Environment tab (not only project-level).
3. Redeploy **nd-api** (and **nd-web** if `WEB_URL` is listed there). No trailing slash; `http` ≠ `https`; `www` ≠ apex.

OIDC must use the same origin for `OIDC_REDIRECT_URI` / Authentik callback.

### Deploy fails: `migrate` exit 1 (api/web never start)

The build log only shows Compose waiting on migrate. **Open the `migrate` service logs** (not the build log). The one-shot runs `/migrate-and-seed.sh` (preflight `psql` + migrate + non-fatal seed).

| Pattern | Meaning | Fix |
| --- | --- | --- |
| `28P01` that comes and goes without any password change | **Two Dokploy apps run this stack** and both put `postgres` on the shared `dokploy-network`; DNS round-robins, so migrate authenticates against the *other* app's database | Delete/stop the stale app and redeploy with a compose where only `web`/`api` join `dokploy-network` |
| Migrate/seed OK, **login** fails with `28P01` | `api` is on `dokploy-network` and still used hostname `postgres`, which resolved another app’s DB (e.g. amae) | Redeploy compose that uses `kh-postgres` / `kh-redis`; or temporarily `docker network disconnect dokploy-network …-api-1` |
| Wipe + first deploy works; **next rebuild fails** | Existing volume: bad password **or** tables without a drizzle journal (often after a partial import) | Read migrate log; do **not** wipe as the routine fix |
| `28P01` / password authentication failed | Env password ≠ volume role password | `ALTER USER … PASSWORD …` or restore original env; avoid `$` in passwords |
| `already exists` / relation already exists | App schema present, `drizzle.__drizzle_migrations` missing/empty | Redeploy after this fix (migrate runs journal baseline first); or re-import / wipe once |
| Seed WARN only | Non-fatal | Stack should still start if migrate succeeded |

After Monitoring **import**, redeploy should succeed: import wipes schemas, restores the dump, then baselines the journal when needed so migrate is idempotent. A failed import cannot leave you empty — the archive and the credentials are verified before the wipe, so an import that reports `28P01` or an unreadable dump has not touched the database.

To fix a `28P01` without losing data, reset the role over the container's trusted local socket, then redeploy:

```bash
docker exec -it <project>-postgres-1 \
  psql -h /var/run/postgresql -U knowledge_hub -d postgres \
  -c "ALTER USER knowledge_hub WITH PASSWORD 'current-dokploy-password';"
```

Check:

```bash
docker logs <project>-migrate-1 --tail 40
docker inspect <project>-migrate-1 \
  --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^POSTGRES_|^DATABASE_URL='

# Duplicate stacks? More than one app here means duplicate service DNS aliases.
docker volume ls | grep knowledge_hub_postgres_data
ls /etc/dokploy/compose | grep knowledge

# Does `kh-postgres` resolve to exactly one address, and is it this app's container?
# (Generic `postgres` on dokploy-network may still point at another app — ignore it.)
docker exec <project>-api-1 getent hosts kh-postgres
docker inspect <project>-kh-postgres-1 \
  --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
```

### `password authentication failed for user "knowledge_hub"` (seed/migrate)

Usually **not** a schema problem. Causes:

1. **`POSTGRES_PASSWORD` in Dokploy ≠ password stored in the Postgres volume** (volume keeps the password from first init; changing the env alone does not update the role). Fix with `ALTER USER … PASSWORD …` or restore the original env value. Avoid `$` in the password — Compose interpolates `$…` in env/command strings. A **new** Dokploy Compose app can still hit this if volumes were pinned to global names (`knowledge_hub_postgres_data`) and the old volume was not removed — remove orphan volumes or use project-scoped volume names (current `compose.dokploy.yaml`).
2. **Special characters in the password** (`&`, `#`, `@`, `*`, …) embedded into `DATABASE_URL` via Compose. Current images rebuild the URL from discrete `POSTGRES_PASSWORD` with percent-encoding. Redeploy after pulling that fix; keep using the same password in Dokploy.
3. **Migrate OK but seed `28P01` (legacy separate seed service)** — fixed by running seed inside the `migrate` one-shot (`/migrate-and-seed.sh`). If you still see a `seed` container, redeploy with `--remove-orphans` (Dokploy’s compose up already uses that). Keep one `POSTGRES_PASSWORD` for the whole Compose project; remove stale service-level `DATABASE_URL` overrides.

## Logs

Use **Admin → Monitoring → Export ops log** for a redacted support + error-audit JSON package. For raw container stdout (api/worker/web), use the **Dokploy UI** per-service logs.

## Backup / export / import (Dev)

**Ops-0 (NF-005):** Compose service `db-backup` writes `pg_dump -Fc` into volume `knowledge_hub_backups` (`/backups`), applies retention, and updates `last-success.json` (+ `scheduler-heartbeat.json`). Overdue dumps catch up immediately; the loop re-reads Admin schedule about once a minute. Disable with `BACKUP_ENABLED=false`, or Admin → Monitoring → schedule (`/backups/schedule.json`).

Scripts live **inside** the `knowledge-hub-db-backup` image (not a bind mount of the git checkout). Dokploy replaces the clone on each deploy; a long-running bind mount previously lost `/scripts/backup-db.sh` after the first overnight wake (`No such file or directory`) while the container kept sleeping 24h without heartbeats. After this change, each deploy rebuilds/recreates `db-backup` with fresh scripts.

The API (and worker) run as uid **1001**. Sidecar dumps are chowned to that uid after each cycle, and the API/worker entrypoints fix volume ownership on start — otherwise Admin **Export** / **Delete** fail with permission errors (the volume is often created root-owned). The API image installs **postgresql-client-16** (PGDG) so `pg_dump` matches Compose Postgres 16.

When `BLOB_PROVIDER=disabled`, avatars, knowledge media, and document-import originals use named volume `knowledge_hub_data` mounted at `/data` on **api and worker** (paths `/data/avatars`, `/data/media`, `/data/imports`). Without that shared mount, uploads fail with EACCES under `/app` and the worker cannot read originals written by the API.

Scripts:

* `export-db.sh` / `backup-db.sh` — dump + stamp + rotate
* `import-db.sh` — full replace (`CONFIRM_IMPORT=REPLACE`); schema wipe by default; optional `WIPE_DATABASE=1`
* `restore-db.sh` — low-level `pg_restore`
* `rotate-backups.sh` — 7d / 4w / 3m retention

Manual export against the Compose postgres container:

```bash
export POSTGRES_CONTAINER=<postgres-container-name>
export POSTGRES_USER=knowledge_hub
export POSTGRES_DB=knowledge_hub
export POSTGRES_PASSWORD=...
./infrastructure/scripts/export-db.sh
# → ./backups/knowledge-hub-….dump + last-success.json
```

Cross-instance / DR import (target instance):

```bash
CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
  POSTGRES_CONTAINER=<target-postgres> POSTGRES_PASSWORD=... \
  ./infrastructure/scripts/import-db.sh ./backups/latest.dump
# then migrate if needed; re-apply target WEB_URL / secrets; smoke login
```

**If the site is unreachable after import:** redeploy alone is not enough when Postgres is half-replaced — **migrate fails** and Compose never starts `api`/`web` (`depends_on: migrate: service_completed_successfully`).

### Recover now (Dokploy)

1. Open the Compose project → check **which services failed**. Look at **`migrate`** logs first (then `api`).
2. Open a terminal on **`db-backup`** (has `/backups` + `/scripts`):

   ```bash
   ls -lt /backups/knowledge-hub-*.dump
   # Prefer a dump from *before* the bad import, or re-upload the known-good local dump into /backups.

   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
     POSTGRES_PASSWORD='your-postgres-password' \
     /scripts/dokploy-recover-db.sh /backups/knowledge-hub-YYYYMMDDTHHMMSSZ.dump
   ```

   If `dokploy-recover-db.sh` is missing (old image/scripts mount), use:

   ```bash
   CONFIRM_IMPORT=REPLACE WIPE_DATABASE=1 \
     POSTGRES_HOST=postgres POSTGRES_PASSWORD='…' \
     /scripts/import-db.sh /backups/<dump>.dump
   ```

3. **Redeploy** (or Restart) the whole stack so `migrate` runs again, then `api` / `web`.
4. Log in with accounts from the **restored** dump.
5. If still down: paste **`migrate`** and **`api`** log tails — that pinpoints the next fix.

**After a live Admin → Monitoring import:** restart **api** + **worker** (and web if Traefik shows 502). Import terminates other Postgres sessions, then the API process exits so Docker can restart it. Log in with accounts from the **imported** dump.

Copy dumps off the volume for transfer (Dokploy volume browser, `docker cp`, or Monitoring download). **Offsite:** set `BLOB_PROVIDER=s3` (+ bucket/keys); Monitoring export and the worker sync upload to `{prefix}/backups/…`. Azure Blob is **NF-007**. Full runbook: [`OPERATIONS.md`](OPERATIONS.md).

## Related

* **Agent handoff (backup / monitoring / local↔Dokploy DB transfer):** [`AGENT_BACKUP_MONITORING_HANDOFF.md`](AGENT_BACKUP_MONITORING_HANDOFF.md)
* Operations & maintenance (future): [`OPERATIONS.md`](OPERATIONS.md)
* Release flow: [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md)
* Milestone plan: [`../milestones/MILESTONE_7_IMPLEMENTATION_PLAN.md`](../milestones/MILESTONE_7_IMPLEMENTATION_PLAN.md)
* Local Compose (host-published PG/Redis): [`DOCKER_COMPOSE.md`](DOCKER_COMPOSE.md)
