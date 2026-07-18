# ADR-004: PostgreSQL as initial search platform

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

MVP needs reliable full-text search without operating an additional search cluster.

## Decision

Use PostgreSQL full-text search first. Keep pgvector available later for optional semantic search.

## Consequences

Lower operational cost and fewer moving parts. Ranking features are more limited than dedicated search engines.

## Alternatives considered

OpenSearch, Elasticsearch, Meilisearch, Typesense.
