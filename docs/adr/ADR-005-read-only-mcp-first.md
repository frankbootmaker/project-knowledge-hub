# ADR-005: Read-only MCP for the MVP

- **Status:** Superseded in part by [ADR-013](ADR-013-draft-only-write-mcp.md)
- **Date:** 2026-07-19

## Context

AI agents need trustworthy retrieval without mutating unverified knowledge.

## Decision

Expose MCP tools as read-only with bearer tokens, scopes, rate limits, and response size limits for the MVP. Writes remained in the human UI/API.

## Consequences

Reduced accidental corruption and secret leakage via agents during the MVP. Draft-only write MCP was added later under ADR-013 with opt-in `knowledge:write` scope.

## Alternatives considered

Read/write MCP immediately; repository-only agent context.
