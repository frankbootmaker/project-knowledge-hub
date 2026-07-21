# Roadmap

Aligned with the PRD development milestones. **Authoritative status:** `docs/MILESTONE_TRACKING.md`.

## Execution order (post–localhost MVP)

Localhost / Compose Postgres+Redis (`pnpm dev`) is the primary environment through feature work.

| Order | Milestone | Focus | Status |
| --- | --- | --- | --- |
| Done | M0–M6 | Foundation through MCP (read + draft write) | Complete |
| Done | **M8** | GitHub synchronization | Complete |
| Done | **M9** | Conversation import (first slice) | Complete |
| Done | **M10** | Semantic and hybrid search (first slice) | Complete |
| **Next** | **M7** | Production packaging and Dokploy | In progress (Dev/UAT packaging) |
**M7 staging:** Dokploy **Dev/UAT** first → validate HTTPS, MCP, persistence, backups → **Prod** only after testing.

Post-milestone ideas (including Doc Factory) live in [`NEXT_FEATURES.md`](NEXT_FEATURES.md). Do not start them until their module brief is precise enough.

## Milestone status (by ID)

| Milestone | Focus | Status |
| --- | --- | --- |
| 0 | Repository and platform foundation | Complete |
| 1 | Identity and workspace foundation | Complete |
| 2 | Project and system catalogue | Complete |
| 3 | Knowledge records | Complete |
| 4 | Versioning and lifecycle | Complete |
| 5 | Search (PostgreSQL FTS) | Complete |
| 6 | MCP (read + draft write) | Complete |
| 7 | Production packaging and Dokploy | In progress (Dev/UAT packaging; Prod later) |
| 8 | GitHub synchronization | Complete |
| 9 | Conversation import | Complete (first slice; later automations deferred) |
| 10 | Semantic and hybrid search (optional) | Complete (first slice; admin settings / model migration deferred) |

## Next features

See [`NEXT_FEATURES.md`](NEXT_FEATURES.md). Doc Factory (NF-001) is **parked** pending a more precise module description.

## Explicitly deferred until after MVP

Kubernetes, microservices, OpenSearch/Elasticsearch, Neo4j, GraphQL, dedicated vector databases, full-lifecycle write MCP (verify/mark-current), collaborative editing, billing, and complex multitenancy.

## Tracking

Update `docs/MILESTONE_TRACKING.md` and `docs/CHANGELOG.md` when milestone status changes.
