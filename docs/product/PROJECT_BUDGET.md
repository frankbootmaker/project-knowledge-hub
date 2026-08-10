# Project budgeting, effort, and multi-RAG health

**Status:** implemented on `feature/project-delivery`  
**Related:** [PROJECT_BASELINE.md](./PROJECT_BASELINE.md), [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_RAID.md](./PROJECT_RAID.md), ADR-018  
**Backlog:** NF-018

## Goal

Track **project currency and BAC**, **stakeholder hourly rates**, **task forecast/actual hours**, roll costs to stories/epics, show **EVM KPIs + burndown**, and surface **Timeline / Risks / Financials** RAG badges beside the project name.

## Decisions

| Topic | Decision |
| --- | --- |
| Currency | Project-level only (no FX). Majors + HUF: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY |
| BAC | `approved_budget`, fallback `initial_budget` |
| Rate attribution | Current owner → RACI **R** → RACI **A**; missing rate → hours roll up, cost `null` |
| Hours | Decimal `forecast_hours` / `actual_hours` on tasks; actual set = confirmed effort |
| PV | Linear BAC × calendar progress between project start→end |
| EV | Σ (`forecast_hours × rate`) for **done** non-cancelled rateable tasks |
| AC | Σ (`actual_hours × rate`) for non-cancelled rateable tasks |
| Burndown | Ideal remaining BAC + daily `project_cost_snapshots` (upserted on budget/effort mutations) |
| Change register | `budget` kind stays narrative; approved/initial budgets edited explicitly |

## Entities

```text
projects
  ├── currency
  ├── initial_budget
  └── approved_budget

project_stakeholders
  └── hourly_rate   (project currency)

project_tasks
  ├── forecast_hours
  └── actual_hours

project_cost_snapshots
  └── (project_id, captured_on) → bac, pv, ev, ac
```

## Financial RAG

| Condition | RAG |
| --- | --- |
| No BAC | green |
| AC > BAC or CPI < 0.9 | red |
| AC > 0.85×BAC or CPI < 1.0 | amber |
| else | green |

Risk RAG uses open/mitigating RAID (`critical` → red, `high` → amber). Timeline RAG reuses delivery schedule rules.

## UI order on project page

1. Summary (+ Timeline / Risks / Financials badges)  
2. Baseline (currency + initial budget)  
3. Stakeholders (Manage modal includes hourly rate)  
4. Delivery (task hours + story/epic effort rollups)  
5. **Budgeting** (approved BAC, KPIs, burndown, epic table)  
6. RAID  
7. Change management  
8. Linked sections  

## API / MCP

* `GET /api/v1/projects/:id/budget-summary`
* `PATCH /api/v1/projects/:id/budget`
* Project / stakeholder / task create-update include budget fields
* MCP: `get_project_budget_summary`, baseline/task/stakeholder money fields (`pm:read` / `pm:write`)

## Out of scope

* Multi-currency / FX  
* Timesheets, capacity calendars, story points  
* Auto-updating approved budget from change-register `budget` items  
* Critical-path Gantt  
* AI-assistant hourly rates  
