# Dokploy Deployment (Dev/UAT)

**Status:** Milestone 7 — Dev/UAT packaging (first slice)  
**Compose entrypoint:** [`compose.dokploy.yaml`](../../compose.dokploy.yaml)  
**Env template:** [`.env.dokploy.example`](../../.env.dokploy.example)

Production cutover, registry automation, and admin log export are **out of scope** for this slice.

## Architecture

```text
Browser ──HTTPS──► web:3100
                      │  Next rewrites (baked at image build)
                      ├── /api/v1/* ──► api:3101
                      └── /mcp      ──► api:3101
api / worker ──► postgres (pgvector/pgvector:pg16)
api / worker ──► redis
```

* Public traffic should hit **only the web** origin (`WEB_URL`).
* Next rewrites are baked at **web image build** via `NEXT_REWRITE_API_ORIGIN=http://api:3101`.  
  **Never** set `API_URL=http://localhost:3101` (or `127.0.0.1`) in Dokploy env — that value is for laptop `pnpm dev` only and will make `/api/v1` proxy to the web container itself (`ECONNREFUSED 127.0.0.1:3101`).
* Postgres and Redis are **not** published to the host in `compose.dokploy.yaml` (Compose network only).
* Set public `WEB_URL=https://<dev-domain>` at runtime for cookies, mail links, and AI discover.
* Optional `MCP_PUBLIC_URL=https://<dev-domain>/mcp` (same-origin via web rewrite).

## Images

| Service | Dockerfile | Image tag |
| --- | --- | --- |
| api (+ migrate one-shot reuses this image) | `infrastructure/docker/api.Dockerfile` | `knowledge-hub-api:dokploy` |
| worker | `infrastructure/docker/worker.Dockerfile` | `knowledge-hub-worker:dokploy` |
| web | `infrastructure/docker/web.Dockerfile` (`ARG NEXT_REWRITE_API_ORIGIN`) | `knowledge-hub-web:dokploy` |

`migrate` has **no** `build:` — only `image: knowledge-hub-api:dokploy` + `pull_policy: never`, so Compose builds the API Dockerfile once (via `api`), then runs migrate from that tag.

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
| (web rewrite target) | **build** (web) | Hardcoded `http://api:3101` — do not override with localhost |
| `POSTGRES_*` | runtime | Compose builds `DATABASE_URL` as `postgres://…@postgres:5432/…` |
| (Redis) | runtime | Fixed `redis://redis:6379` on the Compose network |
| `SESSION_SECRET` | runtime | Long random secret |
| `APP_ENV` | runtime | Use `staging` for Dev/UAT |
| `NODE_ENV` | runtime | Always `production` in containers |
| `MCP_PUBLIC_URL` | runtime | Optional; prefer `https://<domain>/mcp` |
| `EMBEDDING_PROVIDER` | runtime | Default `disabled` (FTS only) |
| `MAIL_DRIVER` | runtime | `console` (default), `smtp`, or `resend` |
| `SMTP_*` / `RESEND_API_KEY` / `MCP_PUBLIC_URL` | runtime | Set only when used — omit empty values |
| `BOOTSTRAP_ADMIN_*` | seed only | Optional first admin |

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
4. Point a domain at the **web** service (port **3100**); enable HTTPS.
5. Set `WEB_URL` to that HTTPS origin. Do not expose Postgres or Redis.

**Networking:** `compose.dokploy.yaml` attaches every service to Compose `default` **and** external `dokploy-network`. That keeps `web` → `api:3101` rewrites working after Dokploy injects Traefik on `web`. If `/api/v1/*` returns a plain-text `Internal Server Error` while `/login` works, `web` cannot reach `api`. Redeploy after pulling this compose, or on the Dokploy host temporarily:

```bash
# Inspect which networks each container has, then bridge them, e.g.:
docker network connect knowledge_hub_net knowledge-hub-dev-vru1om-web-1
# and/or:
docker network connect dokploy-network knowledge-hub-dev-vru1om-api-1
```

**Build dies mid-turbo with no TypeScript error:** almost always **host RAM**. Symptoms: log stops during `tsc` / Next compile; Dokploy shows cancelled/stuck “running”. Mitigations in this repo:

1. `migrate` **reuses** `knowledge-hub-api:dokploy` (no second `api.Dockerfile` build).
2. Dockerfiles use `turbo ... --concurrency=1` to cut peak memory **inside** each image build.
3. Compose still builds **api + web + worker in parallel**. On a small VPS, serialize them on the Dokploy host before deploy:

   ```bash
   # On the Dokploy server (SSH), once — or export in the environment that runs compose:
   export COMPOSE_PARALLEL_LIMIT=1
   ```

   Or temporarily stop other heavy containers, free RAM (`free -h`), then Redeploy. If the queue is stuck after an OOM, clear it in Dokploy Settings and/or restart the Dokploy service.

## Deploy order

1. **Build** api, worker, web images.
2. **Start** postgres + redis; wait until healthy.
3. **Migrate** — Compose `migrate` one-shot runs automatically (`service_completed_successfully` before api/worker).  
   Manual / Dokploy “Run command” on the api image:

   ```bash
   node node_modules/tsx/dist/cli.mjs packages/database/src/migrate.ts
   ```

   Or from a checkout with deps: `DATABASE_URL=... ./infrastructure/scripts/migrate.sh`
4. **Start** api, worker, web.
5. **Optional seed** (once):

   ```bash
   DATABASE_URL=... BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... \
     ./infrastructure/scripts/seed.sh
   ```

   Or Dokploy run on api image (cwd **`/app`**, env on the **same** command line):

   ```bash
   cd /app && BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_PASSWORD='your-long-password' \
     node node_modules/tsx/dist/cli.mjs packages/database/src/seed.ts
   ```

## Follow-ups

* **NF-002** — automatic bootstrap admin via Compose one-shot `seed` after `migrate` when `BOOTSTRAP_ADMIN_*` secrets are set ([`NEXT_FEATURES.md`](../product/NEXT_FEATURES.md)). Until then, use the manual seed command above.
* Admin central log export (after Dev is stable).
* Production Dokploy cutover + immutable image tags.

## Smoke checklist

After deploy:

* [ ] `https://<domain>/` loads the web app
* [ ] `https://<domain>/api/v1/...` reaches the API via rewrite (e.g. login)
* [ ] API health via internal checks / Dokploy: `/health` and `/ready` on api
* [ ] Login (or bootstrap admin after seed)
* [ ] MCP over HTTPS: `https://<domain>/mcp` (or configured `MCP_PUBLIC_URL`)
* [ ] Restart stack; Postgres data persists (named volume)
* [ ] Worker is running (git sync / embedding queues idle is OK)

## Logs

Until admin log export exists, use the **Dokploy UI** (per-service container logs) for api, worker, and web.

## Backup / restore (Dev)

Scripts (Dev-tested path; full DR certification can wait for Prod):

* `infrastructure/scripts/backup-db.sh` — `pg_dump` (`-Fc`)
* `infrastructure/scripts/restore-db.sh` — `pg_restore`

Against the Compose postgres container:

```bash
export POSTGRES_CONTAINER=<postgres-container-name>
export POSTGRES_USER=knowledge_hub
export POSTGRES_DB=knowledge_hub
export POSTGRES_PASSWORD=...
./infrastructure/scripts/backup-db.sh ./backups/dev.dump
./infrastructure/scripts/restore-db.sh ./backups/dev.dump
```

Or with a reachable `DATABASE_URL` and local `pg_dump` / `pg_restore` clients.

Future scheduled / offsite backups, **DB export/import** (incl. cross-instance), blob providers (S3-compatible, Azure Blob, OneDrive/SharePoint), and admin maintenance tooling: [`OPERATIONS.md`](OPERATIONS.md) and backlog **NF-005**–**NF-009**.

## Related

* Operations & maintenance (future): [`OPERATIONS.md`](OPERATIONS.md)
* Release flow: [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md)
* Milestone plan: [`../MILESTONE_7_IMPLEMENTATION_PLAN.md`](../MILESTONE_7_IMPLEMENTATION_PLAN.md)
* Local Compose (host-published PG/Redis): [`DOCKER_COMPOSE.md`](DOCKER_COMPOSE.md)
