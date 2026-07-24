# Milestone 3 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Knowledge-record CRUD, provenance, safe Markdown document view  
**PRD reference:** Milestone 3 in `docs/product/PRD.md`

## Deliverables

* Knowledge-record CRUD API + UI
* Record types, lifecycle statuses, source-of-truth modes
* Optional project and system association
* Provenance via `knowledge_sources` + verification metadata
* Markdown editor with live safe preview
* Document page: TOC, code highlighting, Mermaid client render
* Audit events for create/update/archive
* Sanitization tests (scripts must not execute)

## Permissions

* View: workspace membership or system admin
* Create/update/archive and status changes: `system_admin`, `workspace_admin`, or `maintainer`
* Readers can view but not mutate

## Out of scope (Milestone 4+)

* Immutable version history, restore, mark-current superseding
* Search, MCP, GitHub sync, conversation import

## Completion criteria

* User can create a deployment guide
* Markdown renders safely (no script execution)
* Record can be linked to a system
* Draft vs verified statuses are visibly distinct
* Source and verification metadata are displayed
