# ADR-027: Due-date-aware RAID risk colour

- **Status:** Accepted
- **Date:** 2026-10-17
- **Task:** PRO-T-98
- **Related:** [ADR-016](ADR-016-project-raid-and-delivery-links.md), [ADR-018](ADR-018-project-budgeting-evm.md), [PROJECT_BUDGET.md](../product/PROJECT_BUDGET.md)

## Context

Project health is one backend result: `health { overall, timeline, risk, financial }`. Timeline already turns amber inside `TIMELINE_AT_RISK_DAYS` (7 calendar days) and red when overdue. Risk was severity only: any open or mitigating critical RAID item made the project red, and any high item made it amber. Due date and kind were ignored, so a critical risk a year out looked the same as a critical issue that has already materialised.

## Decision

1. **One function.** `assessRiskRag` in `packages/domain` is the only risk rule. `computeRiskRag` returns its status. The budget summary calls it and copies `riskRag` plus `riskReasons` onto project health. Header, catalogue card, dashboard, REST, and MCP do not reimplement it.
2. **Who counts.** Open and mitigating only. Closed, accepted, cancelled, and archived items stay out.
3. **Red.** A critical item that is overdue, due within the same 7-day window (inclusive), or kind `issue`. Also a high item that is overdue.
4. **Amber.** Any other critical item (due later, or no due date), any other high item, or any item of any severity that is overdue.
5. **Green.** Everything else.
6. **Reasons.** `riskReasons` lists only the groups that produced that colour: count, severity, kind, and cause (`issue`, `overdue`, `due_soon`, `severity`). `dueInDays` is set for `due_soon`. The list is empty when risk is green. The project header tooltip translates those rows (EN, HU, DE).
7. **RAID list.** The due-date cell uses the same window: red when overdue, amber within 7 days. The severity badge is unchanged.

## Consequences

- A critical risk due far in the future is amber. The same risk within 7 days or overdue is red. A critical issue is red regardless of due date.
- `get_project` and `update_project` structured output include `health.riskReasons`. `get_project_budget_summary` returns `riskRag` and `riskReasons` and its description states the rule.
- Delivery board, calendar, and export item colours stay on their own 3-day tone. They are not this signal.
