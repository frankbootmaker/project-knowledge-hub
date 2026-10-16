# ADR-025: Typed many-to-many relations between knowledge records

- **Status:** Proposed
- **Date:** 2026-10-16
- **Task:** PRO-T-24
- **Related:** [ADR-006](ADR-006-explicit-verification-lifecycle.md), [ADR-013](ADR-013-draft-only-write-mcp.md), [ADR-016](ADR-016-project-raid-and-delivery-links.md), [ADR-023](ADR-023-knowledge-document-keys.md)
- **Brief:** (product brief TBD — `docs/product/KNOWLEDGE_RECORD_RELATIONS.md`)

## Context

KnowHub links knowledge records to **delivery work** (`knowledge_record_delivery_links`, ADR-016) and to **RAID items** (`project_raid_record_links`, migration `0052`). Those junctions answer “which epic/story/task/sprint or RAID row does this document support?”

They do **not** answer “how does this document relate to another document?” Today the only record↔record signal is **configuration-series versioning**: `knowledge_records.supersedes_record_id`, set when an operator marks a record `current` and the hub supersedes other `current` rows in the same series (`supersedeOtherCurrentInSeries` in `knowledge-versions.ts`; surfaced on create/update in `knowledge-records-service.ts`). The UI shows a generic superseded lifecycle banner (`KnowledgeRecordDetailView`) but no navigable successor link and no other semantic edges.

Operators and agents already express document relationships in prose and human keys — e.g. architecture doc `FUR-ARCH-2` citing `FUR-ARCH-1` only in markdown — with no queryable graph, no MCP tools, and no “Related records” UI. PRO-T-24 adds first-class **typed, many-to-many** relations between knowledge records, reusing the delivery/RAID link patterns (dedicated table, REST + MCP, maintainer/`knowledge:write` mutations, audit events).

## Decision

### 1. Relation types (minimal v1 catalog)

Store **directed** rows `(from_record_id, relation_type, to_record_id)`. Read APIs **always** return both outbound and inbound edges, labeling inverses for UX and agents.

| Stored `relation_type` (from → to) | Meaning | Inverse label (to → from) | Notes |
| --- | --- | --- | --- |
| `relates_to` | General association | `relates_to` | **Symmetric.** One logical link; persist with canonical ordering `from_record_id < to_record_id` (UUID compare). |
| `depends_on` | From depends on to (prerequisite, upstream doc) | `required_by` | **Directed.** Reject cycles on write (same approach as delivery dependencies). |
| `refines` | From is a narrower / more detailed take on to | `refined_by` | **Directed.** Reject cycles on write. |
| `derived_from` | From is substantively based on to (excerpt, fork, summary source) | `source_for` | **Directed.** Cycles allowed (e.g. mutual derivation) but reject self-links. |
| `contradicts` | From conflicts with to | `contradicts` | **Symmetric.** Canonical ordering like `relates_to`. |

**Explicitly out of v1 relation types**

* **`supersedes` / `superseded_by`** — not duplicated here. Configuration replacement stays lifecycle + `supersedes_record_id` (see §2).
* PRD examples such as `integrates_with`, `deployed_on`, `owned_by` — defer until system/record-type-specific semantics exist; `relates_to` covers “mentioned together” until then.

Inverse names are **read-model only** in v1 (not stored, not writable as a separate type). Writers set the stored forward type from the anchor record’s perspective when using replace APIs (§4).

### 2. Interaction with version supersede (lifecycle series)

| Concern | Configuration series (today) | Typed relations (PRO-T-24) |
| --- | --- | --- |
| Purpose | Which record is **authoritative now** for the same configuration lineage (same `recordType`, same `systemId` or `projectId`, same workspace) | **Semantic** links between records (may differ in type, status, or role) |
| Mechanism | `lifecycle_status` `current` / `superseded` + optional `supersedes_record_id` on the new current row | Rows in `knowledge_record_relations` |
| Cardinality | At most one “previous current” pointer per new current (last superseded in batch) | Many-to-many per type |
| Trigger | Verify / mark-current / create with `current` | Explicit link APIs or UI |

Rules:

1. **Do not auto-create** relation rows when mark-current runs, and **do not** drive lifecycle from relation writes. Two sources of truth would diverge.
2. **UI and `get_knowledge_record`** may **surface both**: lifecycle successor via `supersedes_record_id` (and inverse lookup: records whose `supersedes_record_id` points at this id) **plus** relation edges. The superseded banner should link to the successor record when that pointer exists.
3. Operators **may** manually add `refines` or `derived_from` between a superseded record and its successor for narrative clarity; that is optional documentation, not a substitute for mark-current.
4. **Different series:** `FUR-ARCH-1` and `FUR-ARCH-2` as parallel architecture docs in the same project are **not** auto-linked by mark-current unless they share the configuration-series key (`recordType` + `systemId`/`projectId`). Typed relations are the right tool for “ARCH-2 elaborates ARCH-1” without declaring ARCH-1 superseded.

### 3. Data model

New table `knowledge_record_relations`:

```text
id                    uuid PK
workspace_id          uuid NOT NULL  -- denormalized from records for fast scoping checks
from_knowledge_record_id uuid NOT NULL → knowledge_records.id ON DELETE CASCADE
to_knowledge_record_id   uuid NOT NULL → knowledge_records.id ON DELETE CASCADE
relation_type         text NOT NULL  -- CHECK ∈ v1 enum above
created_by            uuid → users.id ON DELETE SET NULL
created_at            timestamptz NOT NULL DEFAULT now()
```

Constraints and indexes:

* `from_knowledge_record_id <> to_knowledge_record_id`.
* **Unique** `(from_knowledge_record_id, to_knowledge_record_id, relation_type)`.
* For `relates_to` and `contradicts`, application **normalizes** `(min_id, max_id)` before insert so one symmetric edge exists.
* Index `(from_knowledge_record_id)`, `(to_knowledge_record_id)`, and `(workspace_id)`.
* **Workspace:** both endpoints must share the same `workspace_id`; stored `workspace_id` must match.
* **Project:** if either endpoint has non-null `project_id`, both must have the same `project_id`. Workspace-only records (`project_id` null) may link to each other; a project-scoped record may link only to records in the **same** project (not to workspace-only records in v1 — avoids ambiguous delivery/RAID context).
* **Archived records:** retain existing links for read/history. **Mutations** that add or change links touching a record with non-null `archived_at` are rejected (same spirit as blocking content edits on archived rows). Removing links from an archived anchor is allowed only via a dedicated unarchive path (out of scope — treat as blocked in v1).
* **Cycles:** run DAG checks for `depends_on` and `refines` on the **combined** directed graph when adding an edge (anchor may be either endpoint depending on API shape). `relates_to`, `contradicts`, and `derived_from` skip cycle checks (except self-loop).
* **Delete cascade:** deleting a knowledge record removes all incident relation rows.

**Not in v1:** `metadata_json` on links, strength/priority, effective dates, or provenance per edge.

### 4. REST API

Mirror `knowledge-delivery-links` (`apps/api/src/routes/knowledge-delivery-links.ts`):

| Method | Path | Auth |
| --- | --- | --- |
| `GET` | `/api/v1/knowledge-records/:recordId/relations` | Workspace view |
| `PUT` | `/api/v1/knowledge-records/:recordId/relations` | Workspace maintainer (UI); same project-not-archived guard as delivery links when `projectId` is set |

`:recordId` accepts UUID or project document human key (ADR-023).

**GET** returns:

```json
{
  "relations": {
    "outbound": [{ "relationType": "refines", "record": { /* summary card */ } }],
    "inbound": [{ "relationType": "refined_by", "record": { /* summary card */ } }]
  },
  "lifecycleSuccessor": { "id": "...", "humanKey": "FUR-ARCH-2", "title": "..." } | null,
  "lifecyclePredecessor": { ... } | null
}
```

`lifecycle*` fields are derived from `supersedes_record_id`, not from the relations table.

**PUT** body: `{ "links": [ { "targetRecordId": "<uuid|humanKey>", "relationType": "depends_on" | "refines" | "derived_from" | "relates_to" | "contradicts" } ] }` — **replace semantics** for all relations where this record is the **from** endpoint for directed types, and for symmetric types where this record is the canonical `from` after normalization. Inbound-only edges (another record points at this one) are **not** removed by replace; use the anchor on the other record or a future `DELETE` single-edge endpoint (open question).

Max **200** links per request (same cap as delivery links). Validate targets resolve in workspace/project scope.

### 5. MCP tools

Follow `get_knowledge_record_delivery_links` / `set_knowledge_record_delivery_links` naming:

| Tool | Capability | Notes |
| --- | --- | --- |
| `get_knowledge_record_relations` | `knowledge:read` | Same payload shape as REST GET; `recordId` UUID or document key |
| `set_knowledge_record_relations` | `knowledge:write` | Replace outbound links from anchor; acting user + allowlist per ADR-013 |

**`get_knowledge_record`:** include a compact `recordRelations` object (counts + optional cap) on every call, and honor `includeRecordRelations=true` (default **true** for MCP, **false** for REST list/detail unless query param) to avoid bloating paginated content reads. Relation summaries use `id`, `humanKey`, `title`, `recordType`, `lifecycleStatus`, `archivedAt` — not full markdown.

Register tools in the ChatGPT catalog when implemented (delivery links are already catalogued).

### 6. UI

On knowledge record detail (`KnowledgeRecordDetailView`):

1. **Superseded banner (enhancement):** When `lifecycleStatus === 'superseded'`, show the existing warning **and** a prominent link/button to the **lifecycle successor** when `supersedes_record_id` inverse exists (record that lists this id as its `supersedes_record_id`, or walk forward along the chain to `current` if needed). Label e.g. “Superseded by {humanKey}”.
2. **Related records section:** New panel below metadata / above content, grouped by relation type (outbound and inbound subsections). Each row: human key, title, type badge, lifecycle badge, link to detail. Empty state: “No related records” with maintainer action “Add relation” opening a picker (search project/workspace catalogue, same patterns as Documents tabs).
3. **Editor/manage:** Maintainers edit via replace list (multi-type) or add/remove row UX; no inline markdown parsing for v1.

i18n: EN/DE/HU keys alongside existing `supersededWarning`.

### 7. Permissions and audit

* **Read:** `requireWorkspaceView` / `knowledge:read` with workspace allowlist (ADR-009).
* **Write:** `requireWorkspaceMaintainer` for session UI; MCP `knowledge:write` with `actingUserId` (ADR-013). Agents may set relations on drafts and verified records alike; relations do not change lifecycle.
* **Audit:** `knowledge.record_relations_set` on PUT/set tool with `{ recordId, projectId, linkCount, relationTypes }`. No per-edge audit in v1 (matches delivery link batching).

### 8. Migration and rollout

1. **Schema migration** (next drizzle migration after `0063`): create `knowledge_record_relations` + CHECK constraint on `relation_type`.
2. **Backfill:** none. Existing markdown references (e.g. `FUR-ARCH-2` → `FUR-ARCH-1`) stay prose until operators or a **future** optional import job suggest edges.
3. **Rollout order:** (a) domain enum + DB + service layer + cycle checks, (b) REST, (c) MCP get/set + `get_knowledge_record` enrichment, (d) UI section + superseded-by link, (e) changelog + MCP README.
4. **Demo seed:** optionally link two architecture records in the Furnace demo project to exercise UI/MCP docs.
5. **Project move (ADR-024):** relations move with records (`workspace_id` rewrite); no separate junction rewrite if both endpoints belong to the same project.

### 9. Consequences

* Agents can answer “what does this architecture doc build on?” without scraping markdown.
* Graph queries (transitive `depends_on`, contradiction review) become possible in later milestones.
* Relation cardinality is bounded per record only by the 200-link API cap; operators must curate.
* Symmetric and lifecycle semantics remain distinct, avoiding double meaning of “supersedes”.

## Alternatives considered

* **Markdown-only links** — zero schema cost; not queryable; current pain.
* **Reuse `metadata_json` arrays** — no FK integrity, poor MCP ergonomics, rejected.
* **Single `related_record_ids` uuid[]** — untyped; rejected.
* **Store both directions for each inverse pair** — duplicate rows and sync bugs; rejected for v1.
* **Include `supersedes` as a relation type** — overlaps lifecycle; rejected (§2).

## Open questions

1. **Replace semantics vs per-edge DELETE:** Is replace-from-anchor enough, or do maintainers need `DELETE /relations/:linkId` when cleaning inbound edges?
2. **Workspace-only ↔ project-scoped links:** v1 forbids cross-scope; should charter-level workspace docs link down into project docs?
3. **`derived_from` vs `refines`:** Document decision tree for authors (overlap with `decision` record type).
4. **Transitive closure in MCP:** Expose `depth` on get for impact analysis, or keep single-hop only?
5. **Search:** Index relation endpoints in `search_knowledge` / embeddings (e.g. boost neighbors of `current` records)?
6. **Permissions:** Should `knowledge:write` agents be allowed to set `contradicts` on verified records without maintainer review?
7. **Bulk import:** Regex on `[[FUR-ARCH-1]]` / bare keys in markdown to propose `relates_to` — product opt-in?
8. **Systems:** Should `system_id`-scoped records link only within the same system when `project_id` is null?
