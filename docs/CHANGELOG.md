# Changelog

All notable changes to Project Knowledge Hub are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

* UI internationalization (English, German, Hungarian) via `next-intl`, cookie locale, and language switcher.
* Milestone 6 read-only MCP: API clients, Streamable HTTP `/mcp`, scopes, rate/size limits, Cursor setup.
* Milestone 5 search: PostgreSQL FTS index, filtered search API, snippets, `/search` UI.
* Milestone 4 versioning and lifecycle: immutable versions, history/restore, verify, mark-current with supersede.
* Milestone 3 knowledge records: CRUD, provenance, safe Markdown (sanitize/TOC/highlight/Mermaid), document UI.
* Milestone 2 project and system catalogue (CRUD, tags, archive, UI, permission tests).
* API `GET /` discovery document (replaces bare 404 on API root).
* Milestone 1 identity and workspace foundation.
* Session cookies, bootstrap administrator seed, workspace CRUD, audit events.
* Auth and permissions packages (`scrypt` password hashing, role checks).
* Web login, application shell, protected routes, and workspace UI.
* API routes under `/api/v1` for auth and workspaces.
* Next.js rewrite proxy for `/api/v1/*` to keep cookies same-origin.

### Added (Milestone 0)

* Milestone 0 repository and platform foundation.
* pnpm workspaces and Turborepo monorepo layout.
* `apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (Node.js).
* Shared packages: `config`, `database`, `domain`, `observability`.
* README-only stubs for deferred packages.
* PostgreSQL and Redis Docker Compose services (`knowledge-hub-dev`).
* Drizzle ORM schema foundations for organization, workspace, user, membership, project, and system.
* API `GET /health` and `GET /ready` endpoints.
* Web status page (application name, web/API status, environment).
* Worker Redis connectivity with structured readiness logging and graceful shutdown.
* Vitest unit and API integration tests.
* GitHub Actions CI (install, lint, typecheck, test, build).
* Product, architecture, development, deployment, security documentation and ADRs 001–012.
* Tracking documents: `docs/CHANGELOG.md`, `docs/MILESTONE_TRACKING.md`, `docs/MILESTONE_0_IMPLEMENTATION_PLAN.md`.

## [0.1.0] - TBD

* First tagged release after Milestone 0 validation and packaging (Milestone 7).
