# Milestone 2 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Project and system catalogue only  
**PRD reference:** Milestone 2 in `docs/product/PRD.md`

## Deliverables

* Project CRUD API + UI
* System CRUD API + UI (optional `projectId` association)
* Status, ownership, tags, archive behaviour
* Permission tests
* Friendly API `GET /` discovery payload (avoids bare 404 on :3101)

## Permissions

* View: workspace membership or system admin
* Create/update/archive: `system_admin`, `workspace_admin`, or `maintainer`
* Readers can view but not mutate

## Out of scope

* Knowledge records, search, MCP, auth provider changes
