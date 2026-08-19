# Project commercial proposal (from plan + margin)

**Status:** Backlog idea (not scheduled)  
**Builds on:** baseline plan pin + budgeting forecast ([`PROJECT_BASELINE.md`](PROJECT_BASELINE.md), [`PROJECT_BUDGET.md`](PROJECT_BUDGET.md)); optional Doc Factory export ([`DOC_FACTORY.md`](DOC_FACTORY.md)); backlog id **NF-023**.

## Intent

Generate a **customer-facing project proposal** from the current **plan / delivery forecast**, applying a configurable **margin %** on internal cost prices so commercial offer totals stay separate from internal EVM cost (BAC/AC).

## Foundation already shipped

* Baseline pins `initial_plan_record_id` (and charter); currency + `initial_budget` / `approved_budget`.
* Budgeting rolls **forecast hours × rates**, AI OpEx, and catalogue system OpEx; epic/story cost rollups exist.
* Knowledge record type `proposal` already in the catalog (narrative SoT).
* Change register has `budget` kind (narrative); BAC is edited explicitly today.

## Suggested model

| Concept | Proposal |
| --- | --- |
| Cost base | Planned internal cost: person forecast cost + billable AI/system OpEx modes (not AC / EV) |
| Margin | Project-level `proposal_margin_percent` (e.g. `25` → price = cost × 1.25); optional later per-line overrides |
| Price | Commercial offer total = cost base × (1 + margin/100); keep cost and price both visible |
| Artifact | Knowledge record `type=proposal` (Markdown + optional structured cost/price table); link from project / Baseline |
| Optional BAC seed | “Apply offer total → `initial_budget`” (explicit action; never auto-overwrite `approved_budget`) |

```text
plan / delivery forecast → cost lines
        │
        ├── × (1 + margin%) → priced lines / offer total
        │
        └── generate proposal record (+ optional PDF via Doc Factory)
```

## Suggested phases

1. **Margin + preview** — store margin % on project; Budgeting (or Baseline) shows cost vs offer total without writing a document.
2. **Generate proposal** — create/update a `proposal` knowledge record from the plan pin + priced breakdown (people / AI / systems / epics); human edits the narrative afterward.
3. **Export** — Doc Factory / Blank PDF of the proposal for customers.
4. **Refine** — per-role or per-system margin overrides; versioned proposal snapshots; approve → optional seed of `initial_budget`.

## Non-goals (v1)

* Multi-currency / FX or tax engines.
* Changing stakeholder hourly rates or system fees when margin is set (margin is a commercial overlay).
* Auto-replacing EVM BAC/AC with priced offer figures.
* Full CRM / e-signature / invoice lifecycle.

## Open product questions

* One active proposal per project vs version history of priced snapshots.
* Whether margin applies only to people, or also AI / system OpEx lines.
* Agent-authored proposals via MCP (`pm:write` + knowledge create) vs UI-only generate button.
* Whether open roles (unfilled seats) should appear as priced line items before hire.
