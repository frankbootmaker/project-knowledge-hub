# Project baseline, change management, and delivery timeline

**Status:** implemented on `feature/m7-dokploy` (smoke pending)  
**Related:** [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_RAID.md](./PROJECT_RAID.md), [PROJECT_BUDGET.md](./PROJECT_BUDGET.md), ADR-017, ADR-018

## Goal

Capture a project’s **planned kickoff baseline** (dates, charter, initial plan, initial stakeholders), keep a first-class **change register** for controlled plan/timeline changes, and show delivery work as a **fishbone timeline** of duration bars.

## Decisions

| Topic | Decision |
| --- | --- |
| Baseline location | Fields on `projects` + `project_initial_stakeholders` snapshot |
| Project information | Start date is editable. Baseline finish is the approved `end_date`. Forecast finish is the latest delivery-item end. Duration is inclusive working days from the project start through the baseline finish (a single working day is 1). |
| Working calendar | `hours_per_workday` (default 8), Monday-first `workdays_per_week` (default 5), and `project_non_working_days`. Scheduling and the future Gantt share this calendar. |
| Issue key prefix | Workspace-unique `key_prefix` (`AAA` or `AA0`) on Baseline; used for human keys (ADR-019) |
| Charter / plan | Nullable FKs to any project-scoped knowledge record. Matching types are listed first. The stored id may be a UUID; MCP also accepts a document key and returns key and title. |
| Initial stakeholders | Editable snapshot of workspace user IDs — **not** auto-synced with live Stakeholders |
| Change management | First-class register (like RAID), not markdown-only |
| Timeline view | Delivery mode `timeline`: project window + epic/story bars + milestone markers |
| Date ranges | Epics/stories: `start_date`/`end_date`; milestones: `start_date` + existing `target_date` |

## Entities

```text
projects
  ├── start_date / end_date
  ├── hours_per_workday / workdays_per_week
  ├── project_non_working_days
  ├── key_prefix / issue_counters
  ├── charter_record_id → knowledge_records
  ├── initial_plan_record_id → knowledge_records
  └── project_initial_stakeholders

project_change_items
  ├── project_change_delivery_links → epic | user_story | milestone | task (bugs stay tasks)
  └── project_change_record_links → knowledge records

project_epics / project_user_stories / project_milestones
  └── start/end (or start + target) for Timeline
```

### Change fields

* `kind`: `scope` \| `timeline` \| `stakeholder` \| `budget` \| `other`
* `status`: `proposed` \| `approved` \| `rejected` \| `implemented` \| `cancelled`
* Optional requester / approver, effective date, baseline before/after dates
* **Apply to baseline** (`POST /api/v1/project-change-items/:id/apply-baseline`, MCP `apply_project_change_to_baseline`) writes an approved schedule change onto the project, marks the change implemented, sets `baseline_applied_at`, and writes `project.change_baseline_applied`. A second call does not write again.
* Optional documents (`project_change_record_links`; the legacy `knowledge_record_id` column stores the first link for older clients) and delivery links for epics, stories, milestones, and tasks. Sprints stay out. The manage dialog uses Details, Items, Documents, and Media tabs; Add opens a searchable paged picker with a type filter. Media links workspace images and titled URLs and is stored with the change item.

### Boundaries

| In | Out |
| --- | --- |
| Baseline panel above Stakeholders | Freezing live Stakeholders when charter is approved |
| Change register after RAID | Auto-creating changes from every delivery edit |
| Timeline fishbone / duration bars | Full critical-path / dependency Gantt |
| Budget as a change **kind** label | Auto-updating BAC from change items (see [PROJECT_BUDGET.md](./PROJECT_BUDGET.md) for explicit budget fields) |
| Currency + initial budget on Baseline | Multi-currency / FX |

## UI order on project page

1. Summary  
2. **Baseline** (dates, currency, initial budget, pinned docs, initial stakeholders)  
3. Stakeholders  
4. Delivery (list / tree / board / calendar / **timeline**)  
5. **Budgeting** (approved BAC, EVM, burndown)  
6. RAID  
7. **Change management**  
8. Linked systems / knowledge  

## Agents

MCP `pm:read` / `pm:write`:

* `get_project` includes baseline fields, `baselineFinishDate`, `forecastFinishDate`, and inclusive `durationWorkingDays`  
* `update_project_baseline` accepts a charter or plan UUID or document key and returns key and title. `list_project_initial_stakeholders`, `set_project_initial_stakeholders`  
* `list_project_change_items`, `create_project_change_item`, `update_project_change_item`, `apply_project_change_to_baseline`  
* Epic / story / milestone create/update accept start/end (or start/target) dates  
