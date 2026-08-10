# ADR-015: Project Delivery as first-class state with live MCP writes

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** [ADR-013](ADR-013-draft-only-write-mcp.md), [ADR-014](ADR-014-elevated-api-client-capabilities.md)
- **Brief:** [`docs/product/PROJECT_DELIVERY.md`](../product/PROJECT_DELIVERY.md)

## Context

KnowHub projects today are catalogue containers plus linked knowledge. Operators want humans and AI agents to share **one** project context that includes delivery work (milestones, tasks, dates, RACI), not only Markdown documentation.

Knowledge writes correctly stay draft-only (ADR-013). Delivery status (“task done”, “due Friday”, “A = Alice”) is operational state: forcing it through draft knowledge records would break queryability, RACI integrity, and agent workflows.

ADR-014’s propose/confirm pattern fits high-blast catalogue scaffolding; day-to-day task updates need lower friction for agents that actively participate in the project.

## Decision

1. **First-class tables** under `projects`: `project_milestones`, `project_epics`, `project_user_stories`, `project_tasks` (optional story + milestone + `current_owner_user_id`), `project_task_raci`, `project_task_activities`, and hybrid `project_stakeholders` (durable roster + optional `reports_to_user_id`; list merges owner + RACI-derived people).
2. **Live MCP mutations** via opt-in scopes `pm:read` / `pm:write` (not in default scopes). Writes require `actingUserId` and workspace allowlist; optional project allowlist.
3. **No propose/confirm for PM v1** — direct create/update with audit (`actorType: api_client`). Catalogue scaffolding remains on ADR-014 when implemented.
4. **RACI / stakeholder parties are workspace users**; exactly one Accountable (`A`) per task when set; reports-to cycles are rejected. **Current owner** is ball-in-court and may be handed off without rewriting RACI.
5. **Agile hierarchy** Epic → User story → Task is orthogonal to milestone timeboxes.
6. **Knowledge lifecycle unchanged** — agents still only draft knowledge; delivery and documentation remain separate ledgers linked by `projectId`.

## Consequences

* Project page and MCP can treat delivery as structured data (including epic/story and activity timelines).
* Agents with `pm:write` can change live work state; operators must grant that scope deliberately.
* Product boundary shifts toward “project OS” (docs + work); Jira/Linear sync stays out of v1.
* Future NF-010 project ACLs should cover delivery rows the same way as other project-scoped data.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Markdown `plan` / checklist records only | Cannot enforce RACI, dates, or “my open tasks” |
| Draft-only PM via `knowledge:write` | Wrong lifecycle for operational status |
| Propose/confirm for every task edit | Too heavy for active agent participation in v1 |
