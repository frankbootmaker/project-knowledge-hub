# Project budgeting, effort, and multi-RAG health

**Status:** implemented on `feature/m7-dokploy` (smoke pending)  
**Related:** [PROJECT_BASELINE.md](./PROJECT_BASELINE.md), [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), [PROJECT_RAID.md](./PROJECT_RAID.md), ADR-018, ADR-020, [PROJECT_AI_GOVERNANCE.md](./PROJECT_AI_GOVERNANCE.md) (NF-019), [PROJECT_PROPOSAL.md](./PROJECT_PROPOSAL.md) (NF-023 commercial margin)  
**Backlog:** NF-018, NF-019, NF-023

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
| Paid AI (ledger) | Workspace entries in `ai_billing_entries`, not per project. A month's paid total is the sum of `subscription`, `plan_change`, and `on_demand` after day proration. See allocation below. |
| System OpEx modes | On other catalogue systems linked to the project: `flat` \| `one_time` \| `note_only` (`note_only` / unset → **$0**) |
| Flat fee | Monthly amount accrued over project start→end (calendar-day fraction); shared by AI and IT flat modes |
| One-time fee | Full `it_one_time_cost` counted in AC when mode is `one_time` |
| Token fee | Tasks with only `tokens_used`: `(tokens_used / 1000) × ai_token_rate_per_1k`. Tasks with `tokens_input` / `tokens_output` / `tokens_cache` / `tokens_cache_write`: each part × its per-1k rate. A null split rate uses the blended `ai_token_rate_per_1k`. Cache write is a separate price from cache read. `tokens_used` is the sum of the breakdown. This list-price figure is the theoretical API cost. It is not added to AC when a billing-ledger month covers the usage. |
| Budget allocation | Optional soft caps (`ai_budget_allocation` / `it_budget_allocation`); warn in UI; do not block writes in v1 |
| Capacity | Employee assignment / contractor contract window × Mon–Fri × `allocated_daily_hours` |
| Utilization | Views planned / burn / combined; badges under &lt;70%, on_track 70–110%, over &gt;110% |
| Burndown | Ideal remaining BAC + daily `project_cost_snapshots` (upserted on budget/effort/AI/IT-cost mutations) |
| Change register | `budget` kind stays narrative; approved/initial budgets edited explicitly |

## Paid AI allocation (PRO-T-39)

Ledger rows live on the workspace (`ai_billing_entries`), optionally on one AI system. They are not stored per project. Admins edit them under Financials → AI Cost. The project budget page shows only that project’s allocated share.

1. Group rows by month, currency, and system (a null system is the workspace-wide pool, allocated across all projects in the workspace). The paid total is the sum. `plan_change` may be a credit. A row with `service_period_start` and `service_period_end` (inclusive) is split across those calendar months by the number of days in each month before this grouping. 12 October–11 November is 20/31 in October and 11/31 in November. Cents use the largest remainder (`splitBillingEntryByMonth` in `@project-knowledge-hub/domain`) so the slices sum to the row. `period` is the start month (`YYYY-MM`). A row with no service dates keeps the whole amount in `period`. Allocation overrides apply to each month's slice. Migration `0069` backfills existing rows as the first and last day of their `period` month, which leaves that month unchanged.
2. Manual percents (`ai_billing_allocation_overrides`) apply first and must sum to at most 100. Each percent is that share of the pool.
3. The remainder, or the whole pool when there is no override, is split in proportion to token usage in that month. A workspace pool counts every project's tokens. A system pool counts tokens on that system. Projects with no tokens get nothing in this step.
4. If that remainder has no tokens, it is split equally across active projects (idea, planned, active, maintenance, paused; not archived, not completed). A completed project still receives a token share when it used tokens.
5. Cents use the largest remainder so a fully allocated pool sums to its total and never more. Another currency is ignored (no FX).

A month with no ledger rows for that project keeps the PRO-T-38 rule: `aiFlatMonthlyFee` accrued over the project window for `flat` / `mixed`, plus token list-price cost for `api` / `mixed`. With no ledger rows at all, `aiAc` is unchanged.

Theoretical API cost is the same list-price math for every mode, including `tokens_cache_write` × `ai_token_rate_cache_write_per_1k` when that split is present. It is reported beside paid cost (`difference` = paid − theoretical, `ratio` = paid / theoretical) and is not added on top of a ledger month. Soft allocation warnings use the paid amount.

Sprint rows on the summary are theoretical only. Paid fees stay on the calendar month.

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
  ├── ai_token_rate_per_1k            (blended fallback)
  ├── ai_token_rate_input_per_1k
  ├── ai_token_rate_output_per_1k
  ├── ai_token_rate_cache_per_1k
  ├── ai_token_rate_cache_write_per_1k
  ├── ai_cost_notes
  └── ai_budget_allocation

systems (non-AI, project-linked)
  ├── it_cost_mode
  ├── it_flat_monthly_fee
  ├── it_one_time_cost
  └── it_budget_allocation

project_tasks
  ├── forecast_hours / actual_hours
  ├── tokens_used
  ├── tokens_input / tokens_output / tokens_cache / tokens_cache_write
  ├── ai_model_id / ai_pricing_tier
  ├── usage_occurred_at / billing_period   (audit only)
  ├── ai_system_id
  └── cloud_agent_id   (links imported Cursor usage)

project_cost_snapshots
  └── (project_id, captured_on) → bac, pv, ev, ac

ai_billing_entries (workspace)
  ├── period (YYYY-MM, the start month)
  ├── service_period_start / service_period_end (inclusive; null = whole period)
  ├── provider, plan, type, amount, currency
  ├── ai_system_id (null = workspace-wide pool)
  └── paid_at, note, external_ref

ai_billing_allocation_overrides (workspace)
  └── project, period, ai_system_id, percent

ai_usage_imports (workspace)
  └── source (csv; cursor_admin_api reserved), file, actor, row counts
      (inserted, duplicate, linked, no token data, errors)

ai_usage_events (workspace)
  ├── occurred_at, cloud_agent_id, model, kind, max_mode, cost
  ├── tokens_input / tokens_cache_write / tokens_cache / tokens_output / tokens_total
  ├── row_hash unique per workspace (Date + Cloud Agent ID + Model + Total Tokens)
  └── project_task_id null while unassigned
```

## Financial RAG

| Condition | RAG |
| --- | --- |
| No BAC | green |
| AC > BAC or CPI < 0.9 | red |
| AC > 0.85×BAC or CPI < 1.0 | amber |
| else | green |

Risk RAG (PRO-T-98) uses open or mitigating RAID only. Closed, accepted, cancelled, and archived items stay out. The at-risk window is the same `TIMELINE_AT_RISK_DAYS` (7 calendar days, inclusive) as the timeline RAG.

| Open / mitigating item | RAG |
| --- | --- |
| Critical, and overdue, due within 7 days, or kind `issue` | red |
| High and overdue | red |
| Any other critical (due later, or no due date) | amber |
| Any other high | amber |
| Any other severity that is overdue | amber |
| else | green |

A critical issue is red even with no due date. A critical risk due far in the future is amber; the same risk due within 7 days or overdue is red. The rule lives in one function (`assessRiskRag` / `computeRiskRag`). `riskReasons` explains the colour (for example “1 critical issue”, “1 critical risk due in 2 days”, “1 high risk overdue”) and is empty when the risk RAG is green. Project header, catalogue card, dashboard, REST, and MCP all read that same result.

Timeline RAG uses one window, `TIMELINE_AT_RISK_DAYS` (7 calendar days, inclusive). An open task or milestone that is overdue is red; one due within 7 days is amber; otherwise green. Done, cancelled, and undated items do not move it. Overall RAG is the worst of timeline, risk, and financial. If the budget summary fails, financial is null and overall falls back to the timeline RAG only.

The same backend result (`health: { overall, timeline, risk, financial }`) feeds the project header, catalogue cards (`overallRag` = `health.overall`), dashboard health counts, REST project GET/list, and MCP `get_project` / `list_projects`. `status` remains the lifecycle stage. Delivery board, calendar, and export item colours stay on a separate 3-day at-risk tone and are not this signal.

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
* MCP: `get_project_budget_summary`, `get_project_resource_utilization`, `update_project_ai_assistant_cost`, `report_project_task_ai_usage`, `list_ai_usage_imports`, `import_ai_usage_csv`, baseline/task/stakeholder money fields (`pm:read` / `pm:write`)
* Usage CSV: `POST /api/v1/workspaces/:id/ai-usage-imports/preview` and `POST /api/v1/workspaces/:id/ai-usage-imports` (workspace admin). `GET` the import log and `GET .../ai-usage-events/unassigned` follow the same read access as AI Cost. Set `cloudAgentId` on a task to link rows. The Cursor Admin API importer is not built; the `source` column already allows it.

## Out of scope

* Multi-currency / FX  
* Timesheets (story points are Scrum planning only — [PROJECT_SCRUM.md](./PROJECT_SCRUM.md); never used for AC)  
* Auto-blocking writes when AI allocation is exceeded  
* Auto-updating approved budget from change-register `budget` items  
* Critical-path Gantt  
* AI-assistant **hourly** rates (use flat / API / mixed / note-only modes instead)  
* Commercial offer / margin on cost prices (see [PROJECT_PROPOSAL.md](./PROJECT_PROPOSAL.md); keep EVM cost separate from priced proposal)  
