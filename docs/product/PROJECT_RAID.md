# Project RAID + delivery-linked documents

**Status:** implemented on `feature/m7-dokploy` (smoke pending)  
**Related:** [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), ADR-015, ADR-013

## Goal

Give each KnowHub **Project** an operational **RAID** register (Risks, Assumptions, Issues, Dependencies) beside Delivery, and let knowledge documents attach to epics, user stories, and tasks.

## Decisions

| Topic | Decision |
| --- | --- |
| RAID model | First-class tables (not markdown-only record types) |
| RAID ↔ work | Link RAID items to **tasks** only (v1) |
| RAID ↔ documents | `project_raid_record_links` to same-project knowledge records. Not a delivery link |
| Ratings | `severity` required. Optional `probability` and `impact` on the same scale, stored independently |
| Document types | Add `project-charter`, `meeting-minutes`; reuse `decision` for decision-making |
| Doc ↔ work | Junction `knowledge_record_delivery_links` (epic / user_story / milestone / task / sprint). Bugs stay `task` |
| Agents | MCP: RAID under `pm:read` / `pm:write`; delivery links under `knowledge:read` / `knowledge:write` |
| Human keys | `{prefix}-{RR\|RI\|RA\|RD}-{n}` (see [ADR-019](../adr/ADR-019-human-readable-issue-keys.md)) |
| Risk ↔ issue | **Transfer** creates a new item with a new key; source is archived and linked — not an in-place kind edit |

## Entities

```text
projects
  └── project_raid_items
        ├── project_raid_task_links → project_tasks
        └── project_raid_record_links → knowledge_records

knowledge_records
  └── knowledge_record_delivery_links → epic | user_story | milestone | task | sprint
```

### RAID fields

* `kind`: `risk` \| `assumption` \| `issue` \| `dependency`
* `status`: `open` \| `mitigating` \| `accepted` \| `closed` \| `cancelled`
* `severity`: `low` \| `medium` \| `high` \| `critical` (required, default `medium`)
* `probability` and `impact`: same scale, optional, independent of severity
* Optional owner (workspace member), due date, description
* `humanKey` / `issueNumber` / `issueKeyType` (type from kind at create)
* Transfer links: `transferredToRaidItemId` / `transferredFromRaidItemId` (+ human keys on DTOs)
* Task links replaced via `PUT .../tasks`
* Record links replaced via `PUT .../records` and `PUT /api/v1/knowledge-records/:id/raid-items`
* Transfer copies ratings, task links, and record links: `POST /api/v1/project-raid-items/:id/transfer` `{ targetKind: "issue" | "risk" }` (MCP: `transfer_project_raid_item`)

### Boundaries

| In v1 | Out of v1 |
| --- | --- |
| RAID panel after Delivery | RAID board/calendar |
| Delivery-item links from RAID manage UI (epic, story, task, bug, milestone) | RAID → sprint links |
| Documents tab on the RAID dialog (add/remove record links) | Auto-close a schedule-slip risk |
| Media tab on the RAID dialog (workspace images and titled URLs) | Storing media bytes on the RAID row |
| Documents tab on epic, story, task, bug, milestone, and sprint | A separate bug entity type for document links |
| Linked RAID chips on task manage | Record-editor checkboxes for milestone and sprint (those links still persist) |
| RAID Dependencies as register rows | Gantt / critical path (still out of Delivery v1) |

Schedule tone “at risk” (due within 3 days) remains **distinct** from RAID Risks. Project risk health uses the 7-day window (PRO-T-98, [ADR-027](../adr/ADR-027-due-date-aware-raid-risk.md)): the due-date cell is red when overdue and amber within those 7 days. Severity badge stays as it is.

A project can raise one open **risk** when a task, user story, epic, or milestone slips (PRO-T-63, [ADR-026](../adr/ADR-026-schedule-slip-raid.md)). The toggle, working-day threshold (default 2), and watched types live on the project and default off. The hub evaluates on save and once a day. The risk title is `Schedule slip: <KEY> +N days`, `source` is `auto_schedule_slip`, and the list shows an auto badge. A larger slip updates that same open risk. When the slip clears, the risk stays open and gains a closure note.

## REST (summary)

* `GET/POST /api/v1/projects/:projectId/raid-items`
* `GET/PATCH/DELETE /api/v1/project-raid-items/:id`
* `PUT /api/v1/project-raid-items/:id/tasks`
* `PUT /api/v1/project-raid-items/:id/records`
* `GET /api/v1/project-tasks/:taskId/raid-items`
* `GET/PUT /api/v1/knowledge-records/:id/raid-items`
* `GET/PUT /api/v1/knowledge-records/:id/delivery-links`
* `GET /api/v1/knowledge-records/:id/linked-items` — delivery, RAID, and change items that point at the record (same project; archived rows omitted)
* `GET/PUT /api/v1/projects/:projectId/delivery-document-links` (replace the records linked to one epic, story, milestone, task, or sprint)

## UI

* Project page: Stakeholders → Delivery → **RAID** → Linked systems/knowledge
* RAID manage: Details (ratings), Items, Documents, and Media. Items covers epics, stories, tasks, bugs, and milestones. Items and Documents list only what is linked; Add opens a searchable paged picker with a type filter, and Remove drops the checked rows. Links are stored when the RAID item is saved. Media links workspace images and titled URLs and is stored with the same save.
* Task, epic, story, and milestone manage: Documents tab adds and removes delivery links; they are stored when the item is saved. Bugs use the task tab.
* Sprint panel: the same Documents editor stores links as soon as Add or Remove is confirmed
* Task manage: read-only linked RAID chips
* Knowledge record More details: read-only Linked items (key, title, type). RAID opens `?raid=<id>#project-raid`. Tasks and bugs open `?task=<id>#project-delivery`. Sprints open the scrum view. Epics, stories, and milestones open Delivery. Change items open `#project-change`.
* Knowledge editor (edit + project selected): delivery-link multi-select
