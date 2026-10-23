# ADR-019: Human-readable issue keys and RAID risk↔issue transfer

- **Status:** Accepted
- **Date:** 2026-08-11
- **Related:** [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-016](ADR-016-project-raid-and-delivery-links.md), [ADR-017](ADR-017-project-baseline-changes-timeline.md)
- **Brief:** [`docs/product/PROJECT_DELIVERY.md`](../product/PROJECT_DELIVERY.md), [`docs/product/PROJECT_RAID.md`](../product/PROJECT_RAID.md)

## Context

Operators and agents need short, stable labels for delivery and RAID items (e.g. `HL1-T-12`, `HL1-RR-3`). UUID PKs remain the system identity; human keys are a display and resolve path. Changing a RAID risk into an issue in place would break typed key codes (`RR` vs `RI`).

## Decision

1. **Human key format** `{prefix}-{type}-{n}` where prefix is workspace-unique `AAA` or `AA0`, type is `E|S|M|T|B|C|RR|RI|RA|RD`, and `n` is a per-type counter on the project. `B` is a delivery bug (a task row with `item_type = bug`). The letter is chosen at create and is not converted in place.
2. **Persist** `issue_key_type` + `issue_number` at create; compute `humanKey` at read from the project `key_prefix` so prefix renames update display.
3. **Baseline** owns `key_prefix` (REST project PATCH and MCP `update_project_baseline`).
4. **Risk ↔ issue** uses a **transfer** workflow: create a new RAID row with the target kind/key, copy fields and task links, set transfer FKs, archive the source. In-place `risk`↔`issue` kind edits are rejected.
5. **MCP parity**: list/get expose `humanKey`; get/update accept UUID or human key; `transfer_project_raid_item` for transfers.
6. **Prefix history (PRO-T-127).** Changing `key_prefix` inserts the previous value in `project_key_prefix_history`. API and MCP lookups match the current prefix or an unreleased historical prefix and resolve to that project. Display still uses the current prefix. A retired prefix stays reserved in the workspace until a workspace admin releases it. The same prefix in another workspace remains a PRO-T-3 ambiguity: without `projectId` or `workspaceIds`, a key that exists in more than one matching project returns `ISSUE_KEY_AMBIGUOUS`. A historical prefix in one workspace and a live prefix in another are both candidates. Human keys in `?task=`, `?raid=`, and `?change=` on the project page redirect to the entity id.

## Consequences

* UUID remains FK/API path identity; conversational agents can resolve keys.
* Transfer history is an archived chain via `transferred_to` / `transferred_from`.
* Assumptions and dependencies are not transferable in v1.
