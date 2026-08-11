# ADR-020: Stakeholder capacity, utilization, and AI cost modes

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** [ADR-018](ADR-018-project-budgeting-evm.md), [ADR-015](ADR-015-project-delivery-mcp.md)
- **Brief:** [`docs/product/PROJECT_BUDGET.md`](../product/PROJECT_BUDGET.md)

## Context

Projects need people capacity planning (employee vs contractor windows) and a clear way to bill AI assistants into Actual Cost without inventing hourly rates for agents. Token usage arrives when agents finish tasks via MCP/REST.

## Decision

1. **Engagement** on `project_stakeholders`: `employee` | `contractor`, with assignment and/or contract date windows plus `allocated_daily_hours`. Capacity = Mon–Fri days in the window × daily hours.
2. **Utilization** API/MCP with views `planned` | `burn` | `combined`. Demand uses owner → R → A attribution (same as rates). Status badges: under &lt;70%, on_track 70–110%, over &gt;110% of capacity; combined uses max(planned%, burn%). Project `resourceRag` from aggregate planned demand vs capacity.
3. **AI cost modes** on AI `systems` (`ai_assistant`): `flat` | `api` | `mixed` | `note_only`.
   - Flat: monthly fee accrued over project start→end (calendar-day fraction).
   - API: `(tokens_used / 1000) × token_rate_per_1k` from tasks.
   - Mixed: both.
   - Note-only: record tokens; **$0** to AC.
4. Optional `ai_budget_allocation` is a soft UI/RAG hint only (no write blocking in v1).
5. Tasks store `tokens_used` + optional `ai_system_id`. MCP `report_project_task_ai_usage` is the convenience path on completion; snapshots refresh when billable AI spend changes.
6. Budget summary exposes `personAc`, `aiAc`, `aiNoteOnlyTokens`, and per-system AI breakdown. EV remains person-hours only in v1.

## Consequences

* Person AC and AI AC roll into the same snapshot AC used for CPI/financial RAG.
* Capacity without windows/daily hours yields `unknown` utilization for that person.
* Agents should report tokens when finishing AI-worked tasks so API/mixed modes stay accurate.
