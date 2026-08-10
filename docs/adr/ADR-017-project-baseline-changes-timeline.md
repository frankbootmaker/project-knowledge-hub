# ADR-017: Project baseline, change register, and delivery timeline

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-016](ADR-016-project-raid-and-delivery-links.md)
- **Brief:** [`docs/product/PROJECT_BASELINE.md`](../product/PROJECT_BASELINE.md)

## Context

Delivery and RAID give operators live work and risk registers. They still need a **planned baseline** (window, charter, initial plan, kickoff team), a place to **log controlled changes**, and a **schedule view** that is richer than calendar markers but not a full project-scheduling product.

## Decision

1. **Baseline lives on the project**: nullable `start_date` / `end_date`, pinned `charter_record_id` and `initial_plan_record_id` (ON DELETE SET NULL), plus `project_initial_stakeholders` as a manually maintained snapshot of workspace members.
2. **Change management is first-class** (`project_change_items` + `project_change_delivery_links`), mutated via REST and MCP `pm:read` / `pm:write`, audited like RAID.
3. **Delivery items gain date ranges** (epic/story start/end; milestone start alongside `target_date`) so a **Timeline** fishbone view can render duration bars without introducing dependency graphs.
4. **Timeline is in; full Gantt stays out** — RAID Dependencies remain a register; critical path / dependency edges are explicitly deferred.

## Consequences

* Project page order: Baseline → Stakeholders → Delivery → RAID → Changes → Linked sections.
* Agents can adjust baseline pins, initial stakeholders, and change items without inventing markdown records.
* Operators get an MS Project–like swim of durations; unscheduled items stay listed, not forced onto the axis.
