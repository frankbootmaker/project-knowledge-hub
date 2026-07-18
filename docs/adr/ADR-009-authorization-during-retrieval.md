# ADR-009: Authorization applied during retrieval

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Search and MCP must not leak inaccessible records through listings or snippets.

## Decision

Apply authorization filters in queries before returning results, not only at page/route boundaries.

## Consequences

Defense in depth for multi-workspace data. Query complexity increases.

## Alternatives considered

Fetch-then-filter in application memory; rely solely on UI route guards.
