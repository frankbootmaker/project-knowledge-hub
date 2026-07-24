# Milestone 9 — Conversation import (implementation plan)

**Status:** First slice implemented on `feature/m9-conversation-import`  
**Scope:** PRD first implementation only (manual paste → raw store → draft records)

## Objective

Convert pasted LLM conversations / Markdown into structured **draft** knowledge records while keeping the raw paste out of MCP and search.

## Delivered (first slice)

* `conversation_imports` + `conversation_import_records` (migration `0019`)
* Package `@project-knowledge-hub/conversation-import` (schemas/helpers)
* API: create/list/get/archive import; create draft from import
* Web: workspace Imports list / new / detail + create-draft form
* Provenance: `sourceType: conversation`, `sourceReference: importId`, `imported_snapshot`
* Raw imports never queried by MCP or FTS (separate table)

## Out of scope (later)

* Automatic classification / LLM-assisted splitting
* Secret detection / metadata extraction
* ChatGPT / Open WebUI / generic JSON importers
* Async BullMQ import jobs

## Validation

* `pnpm --filter @project-knowledge-hub/conversation-import test`
* `pnpm --filter @project-knowledge-hub/api test` (includes conversation-imports integration)
* Manual: paste → draft → verify lifecycle / search finds draft only

## MCP rule

Default MCP retrieval continues to use knowledge records only. Raw conversation import rows are not exposed as tools or search hits.
