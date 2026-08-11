# Project RAID + delivery-linked documents

**Status:** implemented on `feature/project-delivery`  
**Related:** [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), ADR-015, ADR-013

## Goal

Give each KnowHub **Project** an operational **RAID** register (Risks, Assumptions, Issues, Dependencies) beside Delivery, and let knowledge documents attach to epics, user stories, and tasks.

## Decisions

| Topic | Decision |
| --- | --- |
| RAID model | First-class tables (not markdown-only record types) |
| RAID ↔ work | Link RAID items to **tasks** only (v1) |
| Document types | Add `project-charter`, `meeting-minutes`; reuse `decision` for decision-making |
| Doc ↔ work | Junction `knowledge_record_delivery_links` (epic / user_story / task) |
| Agents | MCP: RAID under `pm:read` / `pm:write`; delivery links under `knowledge:read` / `knowledge:write` |
| Human keys | `{prefix}-{RR\|RI\|RA\|RD}-{n}` (see [ADR-019](../adr/ADR-019-human-readable-issue-keys.md)) |
| Risk ↔ issue | **Transfer** creates a new item with a new key; source is archived and linked — not an in-place kind edit |

## Entities

```text
projects
  └── project_raid_items
        └── project_raid_task_links → project_tasks

knowledge_records
  └── knowledge_record_delivery_links → epic | user_story | task
```

### RAID fields

* `kind`: `risk` \| `assumption` \| `issue` \| `dependency`
* `status`: `open` \| `mitigating` \| `accepted` \| `closed` \| `cancelled`
* `severity`: `low` \| `medium` \| `high` \| `critical`
* Optional owner (workspace member), due date, description
* `humanKey` / `issueNumber` / `issueKeyType` (type from kind at create)
* Transfer links: `transferredToRaidItemId` / `transferredFromRaidItemId` (+ human keys on DTOs)
* Task links replaced via `PUT .../tasks`
* Transfer: `POST /api/v1/project-raid-items/:id/transfer` `{ targetKind: "issue" | "risk" }` (MCP: `transfer_project_raid_item`)

### Boundaries

| In v1 | Out of v1 |
| --- | --- |
| RAID panel after Delivery | RAID board/calendar |
| Task links from RAID manage UI | RAID → epic/story links |
| Linked RAID chips on task manage | Auto-create RAID from schedule “at risk” |
| Doc delivery links in record editor | Doc → milestone links |
| RAID Dependencies as register rows | Gantt / critical path (still out of Delivery v1) |

Schedule tone “at risk” (due within 3 days) remains **distinct** from RAID Risks.

## REST (summary)

* `GET/POST /api/v1/projects/:projectId/raid-items`
* `GET/PATCH/DELETE /api/v1/project-raid-items/:id`
* `PUT /api/v1/project-raid-items/:id/tasks`
* `GET /api/v1/project-tasks/:taskId/raid-items`
* `GET/PUT /api/v1/knowledge-records/:id/delivery-links`
* `GET /api/v1/projects/:projectId/delivery-document-links`

## UI

* Project page: Stakeholders → Delivery → **RAID** → Linked systems/knowledge
* Task manage: read-only linked RAID + linked documents
* Epic/story manage: read-only linked documents
* Knowledge editor (edit + project selected): delivery-link multi-select
