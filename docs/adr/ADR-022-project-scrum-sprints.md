# ADR-022: Project Scrum sprints

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-018](ADR-018-project-budget-effort.md), [ADR-019](ADR-019-human-readable-issue-keys.md), [ADR-023](ADR-023-knowledge-document-keys.md)
- **Brief:** [`docs/product/PROJECT_SCRUM.md`](../product/PROJECT_SCRUM.md)

## Context

Project Delivery has epics/stories/tasks, milestones, and a status kanban. Teams also need Scrum timeboxes (sprints), story-point planning, and ceremony artifacts without overloading milestones or mixing points into EVM actual cost.

## Decision

1. **New entity** `project_sprints` orthogonal to milestones; tasks optionally join via `sprint_id`.
2. **Story points** on tasks for sprint load only; forecast/actual hours remain the costing source (ADR-018/020).
3. **Sixth view mode** `scrum` alongside list/tree/board/calendar/timeline; `board` stays status kanban.
4. **Sprint keys** type `SP` in the human-key system (`{prefix}-SP-{n}`).
5. **Ceremonies** are knowledge records (`sprint_retrospective` / `sprint_review`) linked with `entity_type=sprint`; document keys from ADR-023.
6. **At most one active sprint** per project in v1; close moves unfinished work to backlog or a next planned sprint.

## Consequences

* Backlog is explicit (null `sprint_id`), not “no milestone.”
* Velocity and point burndown are Scrum KPIs, separate from cost burndown.
* MCP can plan membership but must not auto-close sprints without a human actor.
