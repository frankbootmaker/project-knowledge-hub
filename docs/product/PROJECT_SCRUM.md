# Project Scrum / sprints

**Status:** implemented (NF-020) — Phases A–E on `feature/m7-dokploy` (smoke pending)  
**Related:** [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_BUDGET.md](./PROJECT_BUDGET.md), [PROJECT_DOC_KEYS.md](./PROJECT_DOC_KEYS.md), [ADR-022](../adr/ADR-022-project-scrum-sprints.md), [ADR-019](../adr/ADR-019-human-readable-issue-keys.md)  
**Backlog:** NF-020

## Goal

Add a **Scrum delivery mode**: timeboxed sprints, story points, planning wizard, and ceremony knowledge (retro/review) linked to sprints — without replacing the status kanban or conflating points with EVM actual cost.

## Non-goals

* Replacing the status **board** view with Scrum-only UI
* SAFe / multi-team PI planning / portfolio sprints
* Story points driving EVM AC (hours remain the costing SoT)
* Auto-generating and auto-approving retrospective text
* Document keys for workspace-only records (see NF-021)

## Decisions

| Topic | Choice |
| --- | --- |
| View model | Sixth delivery mode `scrum`; keep `board` as status kanban |
| Sprint entity | `project_sprints` (not milestones) |
| Task assignment | Nullable `project_tasks.sprint_id`; backlog = null sprint |
| Effort | Integer `story_points` on tasks; hours stay for budget/EVM |
| Capacity | Optional `capacity_points` on sprint; committed = Σ points |
| Status | `planned` → `active` → `completed` \| `cancelled`; one active sprint per project |
| Planning | Modal sprint planning wizard |
| Ceremonies | Knowledge types `sprint_retrospective` / `sprint_review` + delivery link `entity_type=sprint` |
| Human keys | Sprint `SP` → `{prefix}-SP-{n}`; ceremony docs use RET/REV (NF-021) |

## Entities

```text
project_sprints
  ├── project_id, name, goal, start_date, end_date
  ├── status, capacity_points
  └── issue_key_type / issue_number (SP)

project_tasks
  ├── sprint_id (nullable)
  └── story_points (nullable int)

knowledge_record_delivery_links
  └── entity_type includes sprint
```

## UI (mode = scrum)

1. Sprint header — selector, goal, dates, capacity vs committed, % done by points
2. Board body — status columns filtered to selected sprint
3. Backlog rail — unassigned tasks
4. Planning wizard — create → pull backlog → points → capacity/goal → activate
5. Close sprint — unfinished to backlog or next; create/link retro (`…-RET-n`)

## API / MCP

* CRUD sprints under project; `pm:read` / `pm:write`
* Task patch: `sprintId`, `storyPoints`
* Tools: `list_project_sprints`, update membership/points; no auto-close without human

## Phases

| Phase | Slice |
| --- | --- |
| A | Schema + REST/MCP sprints; task fields |
| B | Delivery view `scrum` + header + filtered board + backlog |
| C | Planning wizard + activate/close |
| D | Ceremony links (depends on NF-021) |
| E | Velocity + point burndown + Definition of Done |

## Verification

* Sprint + points + capacity; board view still project-wide
* Close leaves unfinished in backlog (or next); retro links to sprint with RET key
* Changing only points does not change EVM AC
