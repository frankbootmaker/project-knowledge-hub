# Project Delivery (milestones, tasks, RACI)

**Status:** partial — suite on `feature/m7-dokploy` (Dokploy Dev smoke pending)  
**Backlog:** NF-018  
**Related:** ADR-015, ADR-016, ADR-017, ADR-018; [PROJECT_RAID.md](./PROJECT_RAID.md), [PROJECT_BASELINE.md](./PROJECT_BASELINE.md), [PROJECT_BUDGET.md](./PROJECT_BUDGET.md); ADR-013 (knowledge draft writes), ADR-014 (catalogue propose/commit — separate)

## Goal

Make a KnowHub **Project** the shared system of record for both:

* **Knowledge** — docs, ADRs, plans (existing ledger)
* **Delivery** — milestones, tasks, target dates, RACI (this module)

Humans and AI agents work on the **same** project objects so full project context (docs + work) lives in one place.

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| SoR | KnowHub is the system of record (not a sync mirror of Jira/Linear in v1) |
| Agents | Active participants: MCP can create/update delivery state (live, not draft-only) |
| Human keys | `{prefix}-{E\|S\|M\|T\|B}-{n}`; UUID remains PK; MCP accepts UUID or key (ADR-019). `B` is a bug |
| Identity | RACI parties are **workspace members** only; invite externals first |
| Accountable | Exactly **one** `A` per task |

## Boundaries

| In v1 | Out of v1 |
| --- | --- |
| Milestones under a project; **Timeline** fishbone (duration bars) | Full dependency / critical-path Gantt (RAID **Dependencies** stay a register — see [PROJECT_RAID.md](./PROJECT_RAID.md), [PROJECT_BASELINE.md](./PROJECT_BASELINE.md)) |
| Tasks and bugs (optional milestone link). A bug is a task row with `item_type = bug` | Subtasks / checklists as separate entities |
| Due / target dates; task forecast/actual **hours** (costing in [PROJECT_BUDGET.md](./PROJECT_BUDGET.md)) | Timesheets, capacity calendars (story points live under [PROJECT_SCRUM.md](./PROJECT_SCRUM.md) / NF-020; not used for EVM AC) |
| RACI matrix per task (`R`/`A`/`C`/`I`) | External contacts without accounts |
| REST + UI on project page | Notifications / email digests |
| MCP `pm:read` / `pm:write` (direct commit) | Propose/confirm for PM (keep for catalogue ADR-014) |
| Soft cancel via status | Hard delete via MCP |
| Workspace role auth (view / maintainer) | Project-level ACLs (NF-010) |

Knowledge records stay under ADR-013: agents **draft** docs; delivery state is **operational** and commits immediately when `pm:write` is granted.

## Entities

```text
projects
  ├── baseline + currency/budgets (see PROJECT_BASELINE.md / PROJECT_BUDGET.md)
  ├── project_stakeholders (roster + reports_to + hourly_rate)
  ├── project_epics (+ start/end)
  │     └── project_user_stories (+ start/end)
  │           └── project_tasks (story optional; item_type task or bug)
  ├── project_milestones          ← optional timeboxes (+ start + target_date)
  ├── project_cost_snapshots      ← daily EVM burndown (see PROJECT_BUDGET.md)
  ├── project_raid_items          ← RAID register (see PROJECT_RAID.md)
  │     ├── project_raid_task_links
  │     └── project_raid_record_links → knowledge_records
  ├── project_change_items        ← change register (see PROJECT_BASELINE.md)
  └── project_tasks
        ├── milestone_id (optional)
        ├── user_story_id (optional)
        ├── item_type (task \| bug) + bug fields when bug
        ├── forecast_hours / actual_hours
        ├── current_owner_user_id  ← ball-in-court (≠ RACI)
        ├── project_task_raci
        └── project_task_activities
```

Knowledge documents may link to epics, stories, milestones, tasks, and sprints via `knowledge_record_delivery_links` (charter, meeting minutes, decisions, etc.). Each of those items has a Documents tab that adds and removes its own links. Bugs use the task tab.

Milestones remain **timeboxes**. Agile structure is **Epic → User story → Task**. A task may link to a story and/or a milestone. A **bug** sits in the same places as a task (under a story, or ungrouped) and uses the same hours, RACI, owner, sprint, and budget totals.

### Bugs

A bug is a `project_tasks` row with `item_type = bug`. The type is chosen at create and cannot change, so the human key stays `{prefix}-B-{n}` (tasks stay `{prefix}-T-{n}`).

Bug-only fields, null on tasks:

* **Severity** — `low` \| `medium` \| `high` \| `critical` (same scale as RAID). Default `medium`.
* **Found in** — `development` \| `test` \| `staging` \| `production`, plus an optional build or version note.
* **Repro** — steps, expected behavior, actual behavior (optional text).
* **Resolution** — `fixed` \| `duplicate` \| `wont_fix` \| `cannot_reproduce` \| `works_as_designed`. Asked when closing; save still succeeds if it is empty.
* **Regression** — boolean, default false.
* **Affected system** — optional catalogue system already linked to the project.
* **Duplicate of** — optional link to another bug on the same project. Stored only when resolution is `duplicate`. No self-link and no cycle.

Writes that send bug fields on a task are rejected. Knowledge and RAID links keep entity type `task`; the row's item type says it is a bug. `create_project_task` / `update_project_task` / `list_project_tasks` take `itemType` and the bug fields. There is no separate bug tool.

### Stakeholders (hybrid)

* Durable **roster** rows: project role (`sponsor` / `owner` / `project_manager` / `scrum_master` / `product_owner` / `tech_lead` / `contributor` / `stakeholder` / `other`), optional job title, notes, and `reports_to_user_id` (cycle-checked).
* **Open job roles:** omit `user_id` to create a fill-in-place seat (`kind: open_role`); job title required; optional `roleDescription` + competency tags (`{ name, skillId }` — `skillId` null until a shared catalog exists). Assign a workspace member later on the same row; unassign reopens the seat. Future advertise/hire layer: [`PROJECT_JOB_PORTAL.md`](PROJECT_JOB_PORTAL.md) (NF-022).
* **Derived** people: project `owner_user_id` and anyone on task RACI appear in the unified list with contact fields even without a roster row.
* **AI assistants**: catalogue systems with `system_type = ai_assistant` linked to the project appear as `kind: ai_assistant` (not general Systems like Proxmox). Org-chart edge to `owner_user_id` when that person is in the set.
* Org chart: humans via roster `reports_to`; open roles may report to a person; AI assistants under their owner; unlinked nodes under Ungrouped. Open roles are excluded from utilization capacity math.
* Contact surface: people — display name, full name, email, job title/notes; open roles — title + description/tags; AI assistants — name + summary. General Systems remain in the Systems catalogue.

### Status sets

* Milestone / Epic / User story: `planned` \| `active` \| `done` \| `cancelled`
* Task and bug: `todo` \| `in_progress` \| `blocked` \| `done` \| `cancelled`

### RACI vs current owner

* Standing **RACI** (`R`/`A`/`C`/`I`) is unchanged (one user per task; at most one `A`)
* **`current_owner_user_id`** is ball-in-court; handoff moves owner and writes an activity event **without** rewriting RACI
* Default owner on create: Responsible → Accountable → `createdBy`

### Activity timeline

Append-only `project_task_activities`: `created`, `status_changed`, `comment`, `handoff`, `raci_changed`, `fields_updated`, `owner_set`.

## APIs (REST)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/milestones` | List |
| `POST` | `/api/v1/projects/:projectId/milestones` | Create (maintainer+) |
| `PATCH` | `/api/v1/project-milestones/:milestoneId` | Update |
| `GET`/`POST` | `/api/v1/projects/:projectId/epics` | List / create |
| `PATCH` | `/api/v1/project-epics/:epicId` | Update |
| `GET`/`POST` | `/api/v1/projects/:projectId/user-stories` | List (`?epicId=`) / create |
| `PATCH` | `/api/v1/project-user-stories/:storyId` | Update |
| `GET` | `/api/v1/projects/:projectId/tasks` | List (`?milestoneId=`, `?itemType=task\|bug`) |
| `POST` | `/api/v1/projects/:projectId/tasks` | Create a task or bug (`itemType`); optional `raci`, `userStoryId`, `currentOwnerUserId`, and bug fields |
| `GET` | `/api/v1/project-tasks/:taskId` | Detail + RACI + owner + story |
| `PATCH` | `/api/v1/project-tasks/:taskId` | Update fields / milestone / story / owner |
| `PUT` | `/api/v1/project-tasks/:taskId/raci` | Replace RACI set |
| `GET` | `/api/v1/project-tasks/:taskId/activities` | Timeline |
| `POST` | `/api/v1/project-tasks/:taskId/comments` | Comment |
| `POST` | `/api/v1/project-tasks/:taskId/handoff` | `{ toUserId, note? }` |
| `GET` | `/api/v1/projects/:projectId/stakeholders` | Unified roster + open roles + owner + RACI |
| `POST` | `/api/v1/projects/:projectId/stakeholders` | Upsert roster row (omit `userId` → open role) |
| `PATCH` | `/api/v1/project-stakeholders/:id` | Update roster row (description/competencies) |
| `POST` | `/api/v1/project-stakeholders/:id/assign` | Fill open role `{ userId }` |
| `POST` | `/api/v1/project-stakeholders/:id/unassign` | Reopen seat |
| `DELETE` | `/api/v1/project-stakeholders/:id` | Remove roster row only |
| `GET` | `/api/v1/workspaces/:workspaceId/members` | Active members (view) for pickers |
| `GET` | `/api/v1/me/tasks` | Cross-project tasks where the caller holds a RACI role (`?role=`, `?includeArchived=`) |

Auth: workspace **view** for reads; **maintainer** (or admin) for writes. Archived projects are read-only, except **move**, which an archived project may still use.

`POST /api/v1/projects/:projectId/move` with `{ targetWorkspaceId, dryRun?, confirmCrossOrganization? }` moves the project to another workspace, including one in another organization. The caller must maintain both workspaces. `dryRun` returns conflicts, counts, and tag remaps without writing. A cross-organization move requires `confirmCrossOrganization` because Git tokens and conversation imports travel with the project. See [ADR-024](../adr/ADR-024-project-workspace-move.md).

## MCP

| Scope | Tools |
| --- | --- |
| `pm:read` | milestones/tasks/epics/stories/activities/stakeholders list + `get_project_task` |
| `projects:read` | `list_workspace_members` (for staffing userId pickers) |
| `pm:write` | create/update milestone, epic, story, task; `set_project_task_raci`; `add_project_task_comment`; `handoff_project_task`; stakeholder CRUD + assign/unassign open roles; `move_project` |

`pm:write` requires `actingUserId` + non-empty `allowedWorkspaceIds` (same gate pattern as `knowledge:write`). Optional `allowedProjectIds` restricts project scope. Mutations audit as `actorType: api_client`.

Not in `DEFAULT_MCP_SCOPES`.

## UI

Project detail page gains a **Delivery** section using the same catalogue **search / filter / Add** chrome as linked systems & knowledge:

* View modes: **List** (inline), **Board** / **Calendar** in a full-width modal
* Catalogue list of epics, stories, milestones, and tasks (badges + status filter); story/owner chips on tasks
* **Add** kind select: task / milestone / epic / user story
* **Manage task** modal: fields, current owner + handoff, standing RACI summary, activity timeline + comments
* Board: drag tasks between status columns; owner/story chips; Manage on cards
* Calendar: tasks by due date, milestones by target date. Tasks and bugs may also store an optional start date; the calendar, timeline, and overdue counts still use the due date.
* Inline status changes for maintainers; RACI (A/R) on task create
* **Stakeholders** section (same catalogue chrome): list with contact details; **Org chart** full modal from reports-to
* Home **Dashboard**: collapsible My workspaces / Recently updated; **My tasks** catalogue + Manage modal

## Non-goals

* Replacing the knowledge ledger or auto-approving AI drafts
* Full portfolio / multi-project boards
* Jira/Linear bidirectional sync
* Billing or resource management

## Local verification

1. Migrate DB (`0032`–`0034`)
2. Open a project → Delivery → create epic → story → task with owner; Manage → comment + handoff
3. Grant an API client `pm:read` + `pm:write` → MCP list/create/update task / handoff
4. Confirm audit events for agent mutations
