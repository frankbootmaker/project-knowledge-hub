# ADR-016: Project RAID register and knowledge↔delivery links

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-013](ADR-013-draft-only-write-mcp.md)
- **Brief:** [`docs/product/PROJECT_RAID.md`](../product/PROJECT_RAID.md)

## Context

Delivery (ADR-015) covers work hierarchy and RACI. Operators also need a live **RAID** register and the ability to attach project documents (charter, minutes, decisions) to epics, stories, and tasks without stuffing opaque IDs into `metadata_json`.

## Decision

1. **RAID is first-class operational state** (`project_raid_items` + `project_raid_task_links`), mutated via REST and MCP `pm:read` / `pm:write`, same auth/audit pattern as delivery.
2. **RAID links target tasks only** in v1; epics/stories remain the delivery hierarchy.
3. **Knowledge document types** extend the domain catalog with `project-charter` and `meeting-minutes`; existing `decision` covers decision-making.
4. **Queryable delivery links** live in `knowledge_record_delivery_links` (`entity_type` ∈ epic \| user_story \| task). App layer ensures the record’s `projectId` matches the entity’s project.
5. **Knowledge lifecycle unchanged** (ADR-013): link mutations use `knowledge:write`; content drafts remain draft-only.

## Consequences

* Project page order: Stakeholders → Delivery → RAID → Linked knowledge/systems.
* Agents can maintain RAID and attach docs to work items without conflating them with schedule “at risk” tones.
* RAID “dependency” rows are not a Gantt engine (still out of Delivery v1).
