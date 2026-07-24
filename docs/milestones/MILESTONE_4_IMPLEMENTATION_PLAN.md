# Milestone 4 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Immutable versions, restore, verify, mark-current / supersede  
**PRD reference:** Milestone 4 in `docs/product/PRD.md`

## Deliverables

* `knowledge_record_versions` table (immutable snapshots)
* Version history API + UI
* Optional change message on content updates
* Restore historical version (creates a new version)
* Dedicated verify operation
* Mark-current with automatic superseding of previous current in series
* Historical / superseded status warnings in UI

## Versioning rules

* Create stores version `1`
* Content-affecting updates (`title`, `summary`, `recordType`, `contentMarkdown`, `metadata`) bump `current_version_number` and insert a new immutable row
* Lifecycle-only updates (verify, mark-current, archive, tags/source) do not create versions
* Restore copies a historical snapshot into a new version

## Configuration series (mark-current)

A series is records in the same workspace with the same `recordType` and the same non-null `systemId` (preferred), else the same non-null `projectId`. Marking one record `current` sets other `current` records in that series to `superseded` and links via `supersedes_record_id` when appropriate.

## Out of scope

* Search (M5), MCP (M6), GitHub sync, conversation import
