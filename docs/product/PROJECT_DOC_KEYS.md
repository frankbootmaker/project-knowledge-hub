# Project knowledge document human keys

**Status:** done (NF-021) — schema/allocate/resolve/UI + demo seed on `feature/m7-dokploy` (smoke pending)  
**Related:** [ADR-019](../adr/ADR-019-human-readable-issue-keys.md), [ADR-023](../adr/ADR-023-knowledge-document-keys.md), [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_SCRUM.md](./PROJECT_SCRUM.md)  
**Backlog:** NF-021

## Goal

Give **project-scoped** knowledge records stable, conversational IDs that encode the project and document type (e.g. `HL1-VIS-2`, `HL1-MM-5`, `HL1-RET-1`), matching the delivery/RAID human-key model.

## Non-goals

* Keys for workspace-only records (no `projectId`) in v1
* Encoding language/locale in the key
* Renaming slug to match the human key
* In-place re-key when `recordType` changes (v1 keys are immutable)

## Decisions

| Topic | Choice |
| --- | --- |
| Scope | Allocate only when `projectId` is set at create |
| Format | `{key_prefix}-{DOCCODE}-{n}` |
| Type code | Each `recordType` has `docKeyCode` (2–4 uppercase A–Z) in `RECORD_TYPE_CATALOG` |
| Counters | Same `projects.issue_counters` jsonb, keyed by doc code |
| Persist | `document_key_type` + `document_number` on `knowledge_records` |
| Display | Computed `humanKey` from project `key_prefix` at read |
| Stability | Immutable after create; type badge may diverge if type is edited |
| Resolve | REST/MCP accept UUID or human key for get/update paths that take a record id |
| Ceremony types | `sprint_retrospective` → `RET`, `sprint_review` → `REV` (for NF-020) |

## Entities

```text
projects
  ├── key_prefix
  └── issue_counters   (includes doc codes + delivery types)

knowledge_records
  ├── project_id (nullable)
  ├── record_type
  ├── document_key_type   (nullable; set when project-scoped)
  └── document_number     (nullable)
```

## UI

* Catalogue / record detail: copyable badge with `humanKey` when present
* Search: include human key in match text where list search already exists
* Manage drawer: show human key next to slug

## API / MCP

* Create allocates key when `projectId` present
* Public record DTO: `documentKeyType`, `documentNumber`, `humanKey`
* `get_knowledge_record` / `update_knowledge_record`: `recordId` = UUID or human key
* Backfill existing project-scoped rows ordered by `created_at`

## Phases

| Phase | Slice |
| --- | --- |
| A | Catalog codes + migration + allocate on create + DTO |
| B | MCP/REST resolve by human key |
| C | UI badge + manage detail |
| D | Backfill + search surfacing |

## Verification

* Create project record → `PREFIX-CODE-n`; workspace-only → null `humanKey`
* MCP get by human key returns the same record as UUID
* Changing `recordType` does not change `humanKey`
* Unique per `(project_id, document_key_type, document_number)`
