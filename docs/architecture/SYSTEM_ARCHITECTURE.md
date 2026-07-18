# System Architecture

**Status:** Milestone 0 foundation  
**Style:** Modular monolith

## Runtime processes

| Process | Role |
| --- | --- |
| `apps/web` | Next.js UI (status page in M0) |
| `apps/api` | Fastify HTTP API |
| `apps/worker` | Background jobs (Redis-connected bootstrap in M0) |

Processes share domain packages from one repository. They are not independent microservices.

## Shared packages (implemented in M0)

* `@project-knowledge-hub/config` — Zod-validated environment
* `@project-knowledge-hub/observability` — Pino logging with redaction
* `@project-knowledge-hub/database` — Drizzle schema, client, migrations
* `@project-knowledge-hub/domain` — shared enums / `AppError`

Other packages exist as README stubs until needed.

## Data stores

* PostgreSQL — system of record
* Redis — jobs/cache (connectivity required from M0)

## Boundaries

* Web must not import the database package directly; it calls the API over HTTP.
* Route handlers stay thin; domain logic lives in packages/services.
* Authorization will be applied during retrieval (ADR-009), starting in Milestone 1+.

## Deployment

* Development: Compose project `knowledge-hub-dev` with localhost-bound Postgres/Redis.
* Production target: Dokploy with Docker images built from `infrastructure/docker/*`.

## Diagram

```text
Browser --> Web(:3100) --> API(:3101) --> PostgreSQL
                              |-------> Redis
Worker ----------------------> Redis
```
