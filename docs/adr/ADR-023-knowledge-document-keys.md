# ADR-023: Knowledge document human keys

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** [ADR-019](ADR-019-human-readable-issue-keys.md), [ADR-022](ADR-022-project-scrum-sprints.md)
- **Brief:** [`docs/product/PROJECT_DOC_KEYS.md`](../product/PROJECT_DOC_KEYS.md)

## Context

Delivery and RAID items already expose `{prefix}-{type}-{n}` keys (ADR-019). Knowledge records only had UUID + workspace slug while the record-type catalog grew (charters, minutes, plans, and soon sprint ceremonies). Operators and MCP agents need the same conversational resolve path for project documents.

## Decision

1. **Project-scoped only** — allocate `document_key_type` + `document_number` when create has `projectId`; workspace-only records stay without a human key.
2. **Format** `{prefix}-{DOCCODE}-{n}` using the project `key_prefix` and a per-`recordType` `docKeyCode` (2–4 letters) from `RECORD_TYPE_CATALOG`.
3. **Counters** share `projects.issue_counters` with delivery types; codes must not collide with `E|S|M|T|C|RR|RI|RA|RD|SP`.
4. **Immutability** — keys do not change when `recordType` is edited; re-key is out of v1.
5. **Resolve** — knowledge get/update MCP/REST accept UUID or human key; parse uses a generalized human-key pattern (`[A-Z]{1,4}` type segment).
6. **Backfill** — migration assigns keys to existing project-scoped records by `created_at`.

## Consequences

* UUID remains the FK identity; human keys are display + resolve.
* Ceremony docs (RET/REV) get stable IDs before Scrum UI links them to sprints.
* Prefix renames still update displayed keys because prefix is read from the project at format time.
