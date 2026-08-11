# Project budgeting, effort, and multi-RAG health

**Status:** implemented on `feature/m7-dokploy` (smoke pending)  
**Related:** [PROJECT_BASELINE.md](./PROJECT_BASELINE.md), [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_RAID.md](./PROJECT_RAID.md), ADR-018, ADR-020, [PROJECT_AI_GOVERNANCE.md](./PROJECT_AI_GOVERNANCE.md) (NF-019)  
**Backlog:** NF-018, NF-019

## Goal

Track **project currency and BAC**, **stakeholder hourly rates and capacity**, **task forecast/actual hours**, **AI assistant cost modes**, **catalogue system OpEx**, roll costs to stories/epics, show **EVM KPIs + burndown**, and surface **Timeline / Risks / Financials** RAG badges beside the project name.

## Decisions

| Topic | Decision |
| --- | --- |
| Currency | Project-level only (no FX). Majors + HUF: EUR, USD, GBP, CHF, HUF, PLN, CZK, RON, SEK, NOK, DKK, CAD, AUD, JPY |
| BAC | `approved_budget`, fallback `initial_budget` |
| Rate attribution | Current owner → RACI **R** → RACI **A**; missing rate → hours roll up, cost `null` |
| Hours | Decimal `forecast_hours` / `actual_hours` on tasks; actual set = confirmed effort |
| PV | Linear BAC × calendar progress between project start→end |
| EV | Σ (`forecast_hours × rate`) for **done** non-cancelled rateable tasks (people only; AI tokens do not create EV in v1) |
| AC | Person Σ (`actual_hours × rate`) + billable AI + billable non-AI system OpEx |
| AI cost modes | On AI systems (`system_type = ai_assistant`): `flat` \| `api` \| `mixed` \| `note_only` (`note_only` records tokens at **$0**) |
| System OpEx modes | On other catalogue systems linked to the project: `flat` \| `one_time` \| `note_only` (`note_only` / unset → **$0**) |
| Flat fee | Monthly amount accrued over project start→end (calendar-day fraction); shared by AI and IT flat modes |
| One-time fee | Full `it_one_time_cost` counted in AC when mode is `one_time` |
| Token fee | `(tokens_used / 1000) × ai_token_rate_per_1k` on tasks (AI only) |
| Budget allocation | Optional soft caps (`ai_budget_allocation` / `it_budget_allocation`); warn in UI; do not block writes in v1 |
| Capacity | Employee assignment / contractor contract window × Mon–Fri × `allocated_daily_hours` |
| Utilization | Views planned / burn / combined; badges under &lt;70%, on_track 70–110%, over &gt;110% |
| Burndown | Ideal remaining BAC + daily `project_cost_snapshots` (upserted on budget/effort/AI/IT-cost mutations) |
| Change register | `budget` kind stays narrative; approved/initial budgets edited explicitly |

## Entities

```text
projects
  ├── currency
  ├── initial_budget
  └── approved_budget

project_stakeholders
  ├── hourly_rate
  ├── engagement_type (employee | contractor)
  ├── assignment_start / assignment_end
  ├── allocated_daily_hours
  └── contract_* (ref, budget, start, end)

systems (ai_assistant)
  ├── ai_cost_mode
  ├── ai_flat_monthly_fee
  ├── ai_token_rate_per_1k
  └── ai_budget_allocation

systems (non-AI, project-linked)
  ├── it_cost_mode
  ├── it_flat_monthly_fee
  ├── it_one_time_cost
  └── it_budget_allocation

project_tasks
  ├── forecast_hours / actual_hours
  ├── tokens_used
  └── ai_system_id

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

Resource RAG (utilization): aggregate planned demand vs capacity → amber when over capacity, red when &gt;1.1×.

## UI order on project page

1. Summary (+ Timeline / Risks / Financials badges)  
2. Baseline (currency + initial budget)  
3. Stakeholders (rates, engagement/capacity, AI cost manage, Utilization dashboard)  
4. Delivery (task hours + tokens + story/epic effort rollups)  
5. **Budgeting** (approved BAC, KPIs, person vs AI vs systems AC, burndown, epic table)  
6. RAID  
7. Change management  
8. Linked sections  

## API / MCP

* `GET /api/v1/projects/:id/budget-summary`
* `PATCH /api/v1/projects/:id/budget`
* `GET /api/v1/projects/:id/resource-utilization?view=planned|burn|combined`
* `PATCH /api/v1/systems/:id/ai-cost` (and system PATCH AI fields)
* System create/update IT OpEx fields (`itCostMode`, `itFlatMonthlyFee`, `itOneTimeCost`, `itBudgetAllocation`)
* `POST /api/v1/project-tasks/:id/ai-usage`
* Stakeholder create/update include engagement/capacity/contract fields
* MCP: `get_project_budget_summary`, `get_project_resource_utilization`, `update_project_ai_assistant_cost`, `report_project_task_ai_usage`, baseline/task/stakeholder money fields (`pm:read` / `pm:write`)

## Out of scope

* Multi-currency / FX  
* Timesheets (story points are Scrum planning only — [PROJECT_SCRUM.md](./PROJECT_SCRUM.md); never used for AC)  
* Auto-blocking writes when AI allocation is exceeded  
* Auto-updating approved budget from change-register `budget` items  
* Critical-path Gantt  
* AI-assistant **hourly** rates (use flat / API / mixed / note-only modes instead)  
