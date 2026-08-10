# Project baseline, change management, and delivery timeline

**Status:** implemented on `feature/project-delivery`  
**Related:** [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_RAID.md](./PROJECT_RAID.md), [PROJECT_BUDGET.md](./PROJECT_BUDGET.md), ADR-017, ADR-018

## Goal

Capture a project’s **planned kickoff baseline** (dates, charter, initial plan, initial stakeholders), keep a first-class **change register** for controlled plan/timeline changes, and show delivery work as a **fishbone timeline** of duration bars.

## Decisions

| Topic | Decision |
| --- | --- |
| Baseline location | Fields on `projects` + `project_initial_stakeholders` snapshot |
| Charter / plan | Nullable FKs to project-scoped knowledge records (`project-charter` / `plan`) |
| Initial stakeholders | Editable snapshot of workspace user IDs — **not** auto-synced with live Stakeholders |
| Change management | First-class register (like RAID), not markdown-only |
| Timeline view | Delivery mode `timeline`: project window + epic/story bars + milestone markers |
| Date ranges | Epics/stories: `start_date`/`end_date`; milestones: `start_date` + existing `target_date` |

## Entities

```text
projects
  ├── start_date / end_date
  ├── charter_record_id → knowledge_records
  ├── initial_plan_record_id → knowledge_records
  └── project_initial_stakeholders

project_change_items
  └── project_change_delivery_links → epic | user_story | milestone | task

project_epics / project_user_stories / project_milestones
  └── start/end (or start + target) for Timeline
```

### Change fields

* `kind`: `scope` \| `timeline` \| `stakeholder` \| `budget` \| `other`
* `status`: `proposed` \| `approved` \| `rejected` \| `implemented` \| `cancelled`
* Optional requester / approver, effective date, baseline before/after dates
* Optional knowledge record + delivery entity links

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

* `get_project` includes baseline fields  
* `update_project_baseline`, `list_project_initial_stakeholders`, `set_project_initial_stakeholders`  
* `list_project_change_items`, `create_project_change_item`, `update_project_change_item`  
* Epic / story / milestone create/update accept start/end (or start/target) dates  
