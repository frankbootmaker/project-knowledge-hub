# ADR-005: Read-only MCP for the MVP

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

AI agents need trustworthy retrieval without mutating unverified knowledge.

## Decision

Expose MCP tools as read-only with bearer tokens, scopes, rate limits, and response size limits. Writes remain in the human UI/API.

## Consequences

Reduces accidental corruption and secret leakage via agents. Write-capable MCP is deferred.

## Alternatives considered

Read/write MCP immediately; repository-only agent context.
