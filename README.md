# Project Knowledge Hub

Self-hosted technical documentation and knowledge-management platform for humans and authorized AI agents.

**Status:** Milestone 2 complete — project and system catalogue  
**Primary development host:** Strix Halo Ubuntu Server  
**Deployment target:** Dokploy

## What this is

Project Knowledge Hub centralizes technical knowledge from repositories, Markdown docs, infrastructure deployments, LLM sessions, troubleshooting notes, runbooks, and architecture decisions — without requiring every document to live in Git.

## Stack

* Node.js 24 LTS, TypeScript (strict), pnpm workspaces, Turborepo
* Next.js (`apps/web`), Fastify (`apps/api`), Node worker (`apps/worker`)
* PostgreSQL + Drizzle ORM, Redis, Zod, Pino, Vitest

## Quick start (development)

```bash
cp .env.example .env
docker compose -p knowledge-hub-dev up -d postgres redis
pnpm install
pnpm db:generate   # first time / after schema changes
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Sign in at http://localhost:3100/login using `BOOTSTRAP_ADMIN_*` values from `.env`.

Suggested local ports:

| Service | Port |
| --- | --- |
| Web | http://localhost:3100 |
| API | http://localhost:3101 |

API checks:

* `GET /health`
* `GET /ready` (PostgreSQL + Redis)

## Common commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -p knowledge-hub-dev config
```

Full Compose validation (apps + infra):

```bash
docker compose -p knowledge-hub-dev -f compose.yaml -f compose.production.yaml --profile full up --build
```

## Repository layout

```text
apps/          web, api, worker
packages/      shared libraries (and README stubs for later milestones)
docs/          product, architecture, ADRs, development, deployment, security
infrastructure/docker, compose helpers, scripts
tests/         integration / e2e / fixtures
```

## Documentation

* Product overview: `docs/product/PRODUCT_OVERVIEW.md`
* PRD: `docs/product/PRD.md`
* Roadmap: `docs/product/ROADMAP.md`
* Local development: `docs/development/LOCAL_DEVELOPMENT.md`
* Milestone tracking: `docs/MILESTONE_TRACKING.md`
* Changelog: `docs/CHANGELOG.md`

## Safety rules (Strix Halo)

* Compose project name must be `knowledge-hub-dev`
* Do not modify `/home/frankbootmaker/containers`
* Do not run `docker system prune`, `docker volume prune`, or `docker compose down -v` unless explicitly instructed
* PostgreSQL and Redis bind to localhost only when host ports are published

## License

Private / unpublished unless otherwise specified.
