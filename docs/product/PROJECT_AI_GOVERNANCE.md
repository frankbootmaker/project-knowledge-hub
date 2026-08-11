# Project AI governance (tool and deliverable)

**Status:** planned (NF-019)  
**Related:** [PROJECT_BASELINE.md](./PROJECT_BASELINE.md), [PROJECT_RAID.md](./PROJECT_RAID.md), [PROJECT_BUDGET.md](./PROJECT_BUDGET.md), [PROJECT_DELIVERY.md](./PROJECT_DELIVERY.md), ADR-013, ADR-015–018, ADR-020, **ADR-021**  
**External reference:** PMI *Standard for Artificial Intelligence in Portfolio, Program, and Project Management* (member PDF under `docs/pmi/`; personal use only — do not ship or quote in UI)

## Goal

Make AI use on a KnowHub **project** structured and accountable: declare whether AI is a **tool**, a **deliverable**, or both; capture **scope and value**; enforce **human-in-the-loop** where the project requires it; extend **RAID** and **systems** for AI-specific risk and life cycle; record **stakeholder expectations**, **benefits**, and a lightweight **ethics/legal** checklist.

## Non-goals

* Portfolio / program management product (PPPM heat maps, cross-project optimization)
* Certifiable AI management system (e.g. full ISO/IEC 42001 AIMS)
* Replacing knowledge draft→verify HITL (already ADR-013)
* Auto-blocking all MCP writes globally (policy is **per project**, soft-block first)
* Training or embedding the PMI PDF into models or public docs

## Already shipped (do not rebuild)

* AI assistants as stakeholders; cost modes flat/api/mixed/note_only; tokens → AC (ADR-020)
* Knowledge provenance + AI drafts never auto-current (ADR-006/007/013)
* MCP scopes + audit (`pm:read`/`pm:write`, `actingUserId`)
* RAID register, baseline pins, change register, utilization/capacity

## Decisions

| Topic | Choice |
| --- | --- |
| AI role | `none` \| `tool` \| `deliverable` \| `both` on project |
| Scope SoT | Baseline fields + optional pinned AI charter knowledge record |
| Delivery HITL | Project policy: listed mutation classes need human review flag or soft MCP reject |
| AI risks | RAID tags + optional `systemId`; no separate AI-only risk DB |
| System life cycle | Explicit states on AI systems; decommission notes on archive |
| Stakeholder AI | Optional attitude / concerns / policy-ack on roster |
| Benefits | Lightweight outcomes linked to use cases; compare to AI AC |
| Ethics | Project checklist fields (not a legal opinion product) |

## Entities (target)

```text
projects
  ├── ai_role
  ├── ai_scope_summary (or pin ai_charter_record_id)
  ├── ai_hitl_policy_json   (triggers, escalationUserId, softBlockMcp)
  └── ai_ethics_checklist_json

project_stakeholders
  ├── ai_attitude (support | neutral | oppose | null)
  ├── ai_concerns (text)
  └── ai_policy_acknowledged_at

systems (ai_assistant+)
  ├── ai_lifecycle_status
  ├── allowed_source_project_ids / notes
  └── decommission_notes

project_raid_items
  ├── ai_risk_tags[]  (or metadata)
  └── linked system_id (optional)

project_ai_benefits
  ├── title, status, target_metric, actual_metric
  └── linked system_id / use_case

project_tasks
  ├── ai_assisted (bool)
  └── human_reviewed_at / human_reviewed_by
```

Exact column vs JSON vs knowledge-pin choices land in the Phase A migration.

## HITL policy (sketch)

Triggers (examples; configurable):

* Patch project budget / approved BAC  
* Create/update RAID with severity ≥ high or AI-tagged  
* Task → `done` when `ai_assisted` or tokens present  
* Delete stakeholder / archive AI system  

Behavior v1: **soft** — MCP returns a clear error code (`HITL_REVIEW_REQUIRED`) until a maintainer sets review; session UI shows a review checkbox. Hard block optional later.

## UI (project page)

1. Baseline — AI role + scope / charter pin  
2. Stakeholders — AI attitude/concerns; existing AI cost manage  
3. Delivery — review badge on AI-assisted tasks  
4. RAID — AI tag filter + system link  
5. Systems / AI — life cycle, last validated, sources  
6. Budget — AI AC (existing) + benefits vs spend footnote  
7. Optional **AI governance** collapsible — ethics checklist + HITL policy editor  

## API / MCP

* Extend baseline PATCH / `update_project_baseline` with AI role/scope/HITL fields  
* RAID create/update: AI tags + `systemId`  
* System PATCH: life cycle, sources, decommission notes  
* Task update: `aiAssisted`, human review fields  
* Optional `list_project_ai_benefits` / upsert (pm:read/write)  
* Tool descriptions: when HITL triggers fire, agents must stop and ask a human  

## Phases (build order)

| Phase | Deliverable | Done when |
| --- | --- | --- |
| **A** | `aiRole` + scope/charter on baseline + UI | Role visible; charter pin works |
| **B** | HITL policy + task review flags + MCP soft errors | Triggered write blocked until review |
| **C** | AI RAID tags + system link + filter | Tagged risks in RAID + Risk RAG optional |
| **D** | AI system life cycle + lastValidated + sources | States editable; decommission note on archive |
| **E** | Stakeholder AI expectation fields | Editable on Manage; list badge optional |
| **F** | Benefits entities + ethics checklist UI | Spend vs benefit callout on Budget |

## Verification

* Project with `aiRole=tool` can pin charter and set HITL on “task done”  
* MCP `update_project_task` to done without review returns `HITL_REVIEW_REQUIRED` when policy on  
* AI-tagged RAID links to assistant; filter works  
* Decommission archive requires note; system no longer suggested for new usage  
* Benefits row appears next to AI AC when present  

## References

* ADR-021 (normative decisions)  
* ADR-020 (cost/utilization — keep; this brief adds value/governance)  
* Local PMI PDF: `docs/pmi/std_for_artificial_intelligence_eng.pdf` (do not commit redistributable copies to public forks if license forbids; keep private)
