# Project Delivery (milestones, tasks, RACI)

**Status:** in progress (local MVP on `feature/project-delivery`)  
**Backlog:** NF-018  
**Related:** ADR-015, ADR-013 (knowledge draft writes), ADR-014 (catalogue propose/commit — separate)

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
| Identity | RACI parties are **workspace members** only; invite externals first |
| Accountable | Exactly **one** `A` per task |

## Boundaries

| In v1 | Out of v1 |
| --- | --- |
| Milestones under a project | Dependencies / Gantt / critical path |
| Tasks (optional milestone link) | Subtasks / checklists as separate entities |
| Due / target dates | Time tracking, capacity |
| RACI matrix per task (`R`/`A`/`C`/`I`) | External contacts without accounts |
| REST + UI on project page | Notifications / email digests |
| MCP `pm:read` / `pm:write` (direct commit) | Propose/confirm for PM (keep for catalogue ADR-014) |
| Soft cancel via status | Hard delete via MCP |
| Workspace role auth (view / maintainer) | Project-level ACLs (NF-010) |

Knowledge records stay under ADR-013: agents **draft** docs; delivery state is **operational** and commits immediately when `pm:write` is granted.

## Entities

```text
projects
  ├── project_stakeholders (durable roster + optional reports_to_user_id)
  └── project_milestones
        └── project_tasks (milestone optional)
              └── project_task_raci (user_id + role; unique A per task)
```

### Stakeholders (hybrid)

* Durable **roster** rows: project role (`sponsor` / `owner` / `product_owner` / `tech_lead` / `contributor` / `stakeholder` / `other`), optional job title, notes, and `reports_to_user_id` (cycle-checked).
* **Derived** people: project `owner_user_id` and anyone on task RACI appear in the unified list with contact fields even without a roster row.
* **AI assistants**: catalogue systems with `system_type = ai_assistant` linked to the project appear as `kind: ai_assistant` (not general Systems like Proxmox). Org-chart edge to `owner_user_id` when that person is in the set.
* Org chart: humans via roster `reports_to`; AI assistants under their owner; unlinked nodes under Ungrouped.
* Contact surface: people — display name, full name, email, job title/notes; AI assistants — name + summary. General Systems remain in the Systems catalogue.

### Status sets

* Milestone: `planned` \| `active` \| `done` \| `cancelled`
* Task: `todo` \| `in_progress` \| `blocked` \| `done` \| `cancelled`

### RACI rules

* Roles: `R` (Responsible), `A` (Accountable), `C` (Consulted), `I` (Informed)
* One user may hold at most one RACI role on a given task
* Exactly zero or one `A` row per task; creating/updating must enforce uniqueness
* All `user_id` values must be active members of the project’s workspace

## APIs (REST)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/v1/projects/:projectId/milestones` | List |
| `POST` | `/api/v1/projects/:projectId/milestones` | Create (maintainer+) |
| `PATCH` | `/api/v1/project-milestones/:milestoneId` | Update |
| `GET` | `/api/v1/projects/:projectId/tasks` | List (`?milestoneId=`) |
| `POST` | `/api/v1/projects/:projectId/tasks` | Create; optional `raci` |
| `GET` | `/api/v1/project-tasks/:taskId` | Detail + RACI |
| `PATCH` | `/api/v1/project-tasks/:taskId` | Update fields / milestone |
| `PUT` | `/api/v1/project-tasks/:taskId/raci` | Replace RACI set |
| `GET` | `/api/v1/projects/:projectId/stakeholders` | Unified roster + owner + RACI |
| `POST` | `/api/v1/projects/:projectId/stakeholders` | Upsert roster row |
| `PATCH` | `/api/v1/project-stakeholders/:id` | Update roster row |
| `DELETE` | `/api/v1/project-stakeholders/:id` | Remove roster row only |
| `GET` | `/api/v1/workspaces/:workspaceId/members` | Active members (view) for pickers |

Auth: workspace **view** for reads; **maintainer** (or admin) for writes. Archived projects are read-only.

## MCP

| Scope | Tools |
| --- | --- |
| `pm:read` | `list_project_milestones`, `list_project_tasks`, `get_project_task`, `list_project_stakeholders` |
| `pm:write` | `create_project_milestone`, `update_project_milestone`, `create_project_task`, `update_project_task`, `set_project_task_raci`, `create_project_stakeholder`, `update_project_stakeholder`, `delete_project_stakeholder` |

`pm:write` requires `actingUserId` + non-empty `allowedWorkspaceIds` (same gate pattern as `knowledge:write`). Optional `allowedProjectIds` restricts project scope. Mutations audit as `actorType: api_client`.

Not in `DEFAULT_MCP_SCOPES`.

## UI

Project detail page gains a **Delivery** section using the same catalogue **search / filter / Add** chrome as linked systems & knowledge:

* View modes: **List** (inline), **Board** / **Calendar** in a full-width modal
* Flat list of milestones and tasks (badges + status filter)
* **Add** opens one modal: create a task, or tick **Is milestone** to create a milestone instead
* Board: drag tasks between status columns; milestones shown as chips above
* Calendar: tasks by due date, milestones by target date
* Inline status changes for maintainers; RACI (A/R) on task create
* **Stakeholders** section (same catalogue chrome): list with contact details; **Org chart** full modal from reports-to

## Non-goals

* Replacing the knowledge ledger or auto-approving AI drafts
* Full portfolio / multi-project boards
* Jira/Linear bidirectional sync
* Billing or resource management

## Local verification

1. Migrate DB (`0032_project_delivery`)
2. Open a project → Delivery → create milestone + task + set RACI (one A)
3. Grant an API client `pm:read` + `pm:write` → MCP list/create/update task
4. Confirm audit events for agent mutations
