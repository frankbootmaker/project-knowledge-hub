# Milestone 5 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** PostgreSQL full-text search API + UI (no embeddings)  
**PRD reference:** Milestone 5 / §11.11 in `docs/product/PRD.md`

## Deliverables

* Generated `tsvector` + GIN index on `knowledge_records`
* `GET`/`POST` `/api/v1/search` with workspace-scoped authorization
* Filters: project, system, record type, lifecycle, verified-only, current-only
* Default exclusion of deprecated, superseded, and archived records
* Ranking: title weight + lifecycle boost (current/verified above drafts)
* Snippets in results
* Search UI at `/search`
* Relevance and permission tests

## Out of scope

* Embeddings / hybrid search (M10)
* MCP search tool (M6)
* Cross-workspace search for non-admins
