# Milestone 7 — Production packaging and Dokploy (implementation plan)

**Status:** Dev/UAT packaging slice complete on `feature/m7-dokploy` (operator Dokploy click-deploy remains)  
**Scope:** Ship everything needed to deploy Dev/UAT on Dokploy with HTTPS, persistent data, and a smoke checklist. **Prod** cutover stays out of this slice.

## Objective

Package the monorepo for Dokploy Dev/UAT: buildable images, private data plane, migrate-on-deploy, operator runbook, and thin backup/restore helpers.

## Delivered (this slice)

* Fixed Dockerfiles for api / web / worker (full workspace `package.json` graph, `NODE_ENV=production` during build, web `ARG API_URL`, worker deps, healthchecks)
* [`compose.dokploy.yaml`](../compose.dokploy.yaml) — pgvector Postgres + Redis (no host ports), migrate one-shot, named volumes, healthchecks
* Scripts: `infrastructure/scripts/{migrate,seed,backup-db,restore-db}.sh`
* Operator docs: [`docs/deployment/DOKPLOY.md`](deployment/DOKPLOY.md), [`RELEASE_PROCESS.md`](deployment/RELEASE_PROCESS.md)
* Env template: [`.env.dokploy.example`](../.env.dokploy.example)
* Same-origin `/mcp` rewrite on web (with `/api/v1`)

## Routing model

Browser talks only to the **web** origin. Next rewrites `/api/v1/*` and `/mcp` to the internal API (`API_URL=http://api:3101` at **image build** time). Public `WEB_URL=https://<dev-domain>` at runtime.

## Out of scope (later)

* Production Dokploy environment and immutable registry CI
* Admin central log export (post-Dev follow-up)
* Copying a local laptop DB into Dev
* Kubernetes / HA

## Validation

* `docker compose -f compose.dokploy.yaml --env-file .env.dokploy.example build`
* Migrate one-shot against pgvector Postgres
* Smoke checklist in `DOKPLOY.md` after operator attaches a domain in Dokploy

## Success criteria

* Docker images build cleanly for web/api/worker with the current monorepo
* `compose.dokploy.yaml` brings up the stack without exposing PG/Redis publicly
* Migrations runnable as a one-shot
* `DOKPLOY.md` is enough to attach a domain and deploy Dev/UAT
* Backup/restore scripts exist and are documented
