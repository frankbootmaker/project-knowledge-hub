# ADR-006: Explicit verification lifecycle

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

AI-generated content must not silently become authoritative operational truth.

## Decision

Use explicit lifecycle statuses (draft, review_required, verified, current, superseded, deprecated, archived) with authorized transitions.

## Consequences

Clear UI/MCP filtering defaults. Requires maintainer workflows for verification.

## Alternatives considered

Implicit trust of latest edit; binary published/unpublished only.
