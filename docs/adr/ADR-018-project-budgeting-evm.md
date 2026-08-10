# ADR-018: Project budgeting, effort costing, and multi-RAG health

- **Status:** Accepted
- **Date:** 2026-08-10
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-016](ADR-016-project-raid-and-delivery-links.md), [ADR-017](ADR-017-project-baseline-changes-timeline.md)
- **Brief:** [`docs/product/PROJECT_BUDGET.md`](../product/PROJECT_BUDGET.md)

## Context

Baseline and delivery give operators a plan window and live work. They still need a **working BAC**, **person rates**, **task effort**, pragmatic **EVM** (BAC/EV/AC/PV/CPI/SPI), a simple **burndown**, and separate health signals for **timeline**, **risks**, and **financials**.

## Decision

1. **Project currency + budgets** live on `projects` (`currency`, `initial_budget`, `approved_budget`). No FX in v1.
2. **Hourly rates** live on durable `project_stakeholders` rows in project currency.
3. **Effort** is decimal hours on tasks; cost uses owner → R → A rate attribution; missing rates exclude cost from AC/EV but still roll hours.
4. **Snapshots** (`project_cost_snapshots`) capture daily BAC/PV/EV/AC for burndown after budget/effort mutations.
5. **Header RAG** replaces a single delivery badge with three labeled chips (Timeline / Risks / Financials).

## Consequences

* Project page inserts a **Budgeting** section after Delivery and before RAID.
* Agents can read EVM via `get_project_budget_summary` and write rates/hours/budgets under `pm:write`.
* Change-register `budget` kind remains narrative; it does not auto-mutate BAC.
