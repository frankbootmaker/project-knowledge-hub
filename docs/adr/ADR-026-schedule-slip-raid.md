# ADR-026: Auto RAID risk when a delivery schedule slips

- **Status:** Accepted
- **Date:** 2026-10-17
- **Task:** PRO-T-63
- **Related:** [ADR-016](ADR-016-project-raid-and-delivery-links.md), [PROJECT_RAID.md](../product/PROJECT_RAID.md)

## Context

Delivery items already store a finish (task due, story/epic end, milestone target) and parents roll child dates up on save. There is no critical-path calculation. A slip has to be visible in RAID without a person filing the risk, and without a new risk every time the same item slips further.

## Decision

1. **Baseline finish.** Each task, story, epic, and milestone stores `baseline_finish_date`, set to the first saved finish and left unchanged after that. Migration `0067` backfills it from the current finish so turning the feature on does not invent a forecast slip. Overdue items can still raise a risk.
2. **Slip.** Working days, using the project calendar. A watched item slips when its planned finish (own finish, or the child rollup used for parents and milestone links) is later than its stored due date or its baseline, or the due date is before today and the item is not done or cancelled. The slip size is the larger of those gaps. Below the project threshold (default 2) is not a slip.
3. **One open auto risk.** `source = auto_schedule_slip` plus the entity id. A partial unique index allows one open, mitigating, or accepted row per item. A larger slip updates title, days, probability, and impact. Probability, impact, and severity follow the slip size (5 / 10 / 20 working days). Critical path is not computed; an optional flag would raise the rating one step if a later change supplies it.
4. **No auto-close.** A resolved slip appends a closure note and sets `closure_suggested`. Status stays whatever a person set.
5. **Off by default.** `schedule_slip_risk_enabled`, threshold, and watched types (`task`, `user_story`, `epic`, `milestone`) are project settings. Disabled projects are not scanned. The worker runs the same sync daily.

## Consequences

- Save paths and the daily job share `syncScheduleSlipRisks` in the database package so the worker does not import the API.
- The RAID list shows an auto badge. Gantt and Tree show a warning on the slipping item.
- A person closes the risk. Closing it allows a later slip to raise a new one.
