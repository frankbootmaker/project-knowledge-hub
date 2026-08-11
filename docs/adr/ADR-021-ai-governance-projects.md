# ADR-021: AI governance for projects (tool and deliverable)

- **Status:** Accepted (phased)
- **Date:** 2026-08-11
- **Related:** [ADR-013](ADR-013-draft-only-write-mcp.md), [ADR-015](ADR-015-project-delivery-mcp.md), [ADR-016](ADR-016-project-raid-and-delivery-links.md), [ADR-017](ADR-017-project-baseline-changes-timeline.md), [ADR-020](ADR-020-stakeholder-resources-ai-cost.md)
- **Brief:** [`docs/product/PROJECT_AI_GOVERNANCE.md`](../product/PROJECT_AI_GOVERNANCE.md)
- **Backlog:** NF-019
- **External reference (licensed, do not redistribute):** PMI *Standard for Artificial Intelligence in Portfolio, Program, and Project Management* (local copy under `docs/pmi/` for personal member use only)

## Context

KnowHub already treats AI as a **delivery participant** (AI assistant systems, MCP `pm:write`, token cost modes, knowledge draft/HITL). PMI’s AI standard frames responsible adoption around eight principles and five performance domains, and stresses that AI is both a **tool in PPPM** and sometimes a **deliverable**. KnowHub is project-centric; portfolio/program layers stay out of scope for this ADR.

Gaps relative to that framing: explicit AI **scope/role** on a project, **HITL policy for live delivery writes**, AI-specific **risk taxonomy**, AI system **life cycle / validation**, stakeholder **expectations about AI**, and **benefits** versus AI spend.

## Decision

1. **Dual role.** Every project may declare `aiRole`: `none` | `tool` | `deliverable` | `both`. Tool = agents/assistants supporting delivery; deliverable = the project produces an AI capability. Required gates differ by role (see brief).
2. **AI scope lives on baseline.** Pin or store an AI charter / scope summary (vision, in/out of scope use cases, value hypotheses, safeguards). Prefer a pinned knowledge record type or baseline fields — not a separate product silo.
3. **HITL for delivery is policy-driven.** Knowledge remains draft→human verify (ADR-013). Delivery stays live by default, but projects may define **intervention triggers** (e.g. budget mutate, RAID ≥ high, task done, stakeholder delete) that require a human maintainer review flag or soft-block for MCP clients. Triggers and escalation owner are project-scoped.
4. **Extend RAID, do not fork it.** Add AI risk tags (or structured subtype) and optional `systemId` link. Risk RAG may optionally surface AI-tagged open items; full GRC suite is out of scope.
5. **AI system life cycle.** For `ai_assistant` (and later AI-product systems): states covering initiate/plan → data → develop → deploy → monitor → optimize → decommission. Archive/decommission requires retention/unlink notes. Surface `lastValidatedAt` and allowed knowledge sources for RAG quality.
6. **Stakeholder AI expectations.** Optional roster fields: attitude toward AI, concerns, acknowledgment of decision/HITL policy. Supports engagement without inventing a separate CRM.
7. **Benefits beside cost.** Track lightweight benefit/outcome items linked to AI use cases; compare to AI AC / soft allocation (ADR-020). No full benefits-management suite in v1.
8. **Ethics/legal checklist.** Project-level checklist (regulation pointers, IP/attribution for GenAI, accountability owner, data classes allowed in prompts) as structured fields or a pinned knowledge checklist — not a certifiable AIMS (ISO/IEC 42001) product.
9. **Portfolio deferred.** Cross-project AI portfolio heat maps and program benefits rollups are explicitly **out of scope** until a portfolio product brief exists.

## Phasing (NF-019)

| Phase | Slice | Unlocks |
| --- | --- | --- |
| **A** | `aiRole` + AI scope/charter on baseline | Scope domain |
| **B** | HITL policy + task review flags for delivery | Risk / HITL |
| **C** | AI-tagged RAID + system links | AI risk domain |
| **D** | AI system life cycle + validation/sources UI | Architecture / data quality |
| **E** | Stakeholder AI expectation fields | Stakeholder expectations |
| **F** | Benefits vs AI spend + ethics checklist | Strategic value / ethics |

## Consequences

* Aligns KnowHub project AI with the standard’s tool-vs-deliverable and HITL emphasis without copying PMI text into the product.
* Builds on ADR-013/015/016/017/020 instead of parallel registers.
* MCP agents remain powerful; policy can constrain high-impact writes per project.
* Implementers must not train models on, redistribute, or quote the PMI PDF in product UI/docs beyond section references.
