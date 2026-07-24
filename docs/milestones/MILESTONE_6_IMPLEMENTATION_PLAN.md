# Milestone 6 — Implementation Plan

**Status:** Complete (validated)  
**Date:** 2026-07-19  
**Scope:** Read-only MCP with bearer API clients  
**PRD reference:** Milestone 6 / ADR-005

## Deliverables

* `api_clients` table (hashed tokens, scopes, workspace/project allowlists)
* `/api/v1/api-clients` CRUD + rotate (system admin)
* `POST`/`GET`/`DELETE` `/mcp` Streamable HTTP (JSON response mode)
* Tools: list/get projects & systems, list/search/get knowledge, provenance
* Scopes, Redis rate limit (60/min), response size caps
* MCP audit events
* Cursor configuration example

## Defaults

* Scopes: `projects:read`, `systems:read`, `knowledge:read`, `knowledge:search`, `provenance:read`
* Content truncated at 50_000 characters
* List/search limit capped at 25 for MCP
