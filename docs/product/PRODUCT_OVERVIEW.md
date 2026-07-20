# Product Overview

**Product:** Project Knowledge Hub  
**Version:** 0.1 (Milestone 0 foundation)

## Summary

Project Knowledge Hub is a self-hosted technical knowledge platform. It is designed to become the discovery layer for:

* Project and system catalogues
* Hub-managed Markdown knowledge records
* Verified configurations and runbooks
* Later: Git-synchronized docs, conversation imports, and optional semantic search

Humans use a wiki-style web UI. Authorized AI agents (for example Cursor) will use a read-only MCP interface after Milestone 6.

## Principles

1. Multiple sources of truth (Git-managed, hub-managed, imported, AI draft, external).
2. Verification is explicit — AI output is never automatically authoritative.
3. Provenance is mandatory.
4. Human and AI access are equal product priorities.
5. Start as a modular monolith.

## Current milestone

Milestone 0 delivers the monorepo, shared packages, API health/readiness, web status page, worker bootstrap, Postgres/Redis Compose stack, migrations for core catalogue entities, CI, and documentation.

Product CRUD, authentication UI, knowledge records, search, and MCP are intentionally out of scope until later milestones.

## Related documents

* `PRD.md` — full requirements
* `ROADMAP.md` — milestone sequence
* `NEXT_FEATURES.md` — post-milestone feature backlog
* `DOC_FACTORY.md` — Doc Factory design notes (parked; NF-001)
* `../architecture/SYSTEM_ARCHITECTURE.md`
* `../MILESTONE_TRACKING.md`
