# Milestone 0 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Repository and platform foundation only  
**PRD reference:** `docs/project-knowledge-hub-prd.md` / `docs/product/PRD.md`

---

## Environment inspection (pre-implementation)

| Check | Result |
| --- | --- |
| Repository path | `/home/frankbootmaker/projects/project-knowledge-hub` |
| Existing content | Git repo + `docs/project-knowledge-hub-prd.md` only |
| Node.js | Not installed initially; install Node.js 24 LTS via nvm |
| pnpm | Enable via Corepack after Node install |
| Docker / Compose | Docker 29.6.1, Compose v5.3.1 |
| Ports 3100 / 3101 / 5432 / 6379 | Not in use at inspection time |
| `/home/frankbootmaker/containers` | Present (comfyui, ollama, open-webui); **will not be modified** |
| Compose project name | `knowledge-hub-dev` |

---

## Assumptions

1. Node.js 24 may be installed in user space (nvm) if system packages are unavailable or wrong major version.
2. Development Compose exposes Postgres/Redis on localhost only.
3. Milestone 0 includes minimal schema for organization, workspace, user, membership, project, and system — no knowledge-record tables and no business CRUD APIs.
4. Stub packages contain README-only placeholders (no fake APIs).
5. Existing PRD paste remains at `docs/project-knowledge-hub-prd.md`; product docs also include `docs/product/PRD.md`.

---

## Conflicts / risks

| Risk | Mitigation |
| --- | --- |
| Port collision with future services | Bind only 3100/3101 for apps; DB/Redis localhost-only |
| Accidental Docker cleanup | Never run prune / `down -v` |
| Touching unrelated stacks | Never edit `/home/frankbootmaker/containers` |
| Over-scoping Milestone 0 | No auth providers, MCP, Git sync, embeddings, or knowledge APIs |

---

## Proposed dependency list

### Root / tooling

* `typescript`, `turbo`, `prettier`, `eslint`, `@eslint/js`, `typescript-eslint`
* `vitest`, `@types/node`
* `tsx` (dev runners / migrations)

### `apps/web`

* `next`, `react`, `react-dom`
* Shared: `@project-knowledge-hub/config`, `@project-knowledge-hub/observability` (status page may call API over HTTP only)

### `apps/api`

* `fastify`, `@fastify/sensible` (or custom error handler)
* `zod`, `ioredis` / `redis`, `drizzle-orm`, `postgres` (or `pg`)
* Shared packages: `config`, `database`, `observability`, `domain` (types only as needed)

### `apps/worker`

* `ioredis` / `redis`, `zod`
* Shared: `config`, `observability`, `jobs` (README stub until later)

### `packages/config`

* `zod`

### `packages/database`

* `drizzle-orm`, `drizzle-kit`, `postgres` (or `pg`)

### `packages/observability`

* `pino`, `pino-pretty` (dev)

### Intentionally deferred

* Auth libraries, MCP SDK, BullMQ production wiring, embeddings, Git connectors, UI component library beyond minimal Next page

---

## Implementation sequence

1. Create tracking docs (`CHANGELOG.md`, `MILESTONE_TRACKING.md`, this plan).
2. Scaffold monorepo root (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, TS/ESLint/Prettier).
3. Create package skeletons + implement `config`, `observability`, `database`, `domain`.
4. Implement `apps/api` (`/health`, `/ready`, error handler, graceful shutdown).
5. Implement `apps/worker` (config validate, Redis connect, readiness log, shutdown).
6. Implement `apps/web` status page (ports 3100).
7. Docker Compose + Dockerfiles + health checks.
8. Drizzle schema + initial migration.
9. Tests + GitHub Actions.
10. Full documentation set + ADRs.
11. Final validation commands.

---

## Out of scope (do not implement)

* Milestone 1+ features (login, workspace CRUD UI/API, knowledge records, MCP, Git sync)
* Caddy, Kubernetes, GraphQL, vector DBs, OpenSearch/Elasticsearch/Neo4j
