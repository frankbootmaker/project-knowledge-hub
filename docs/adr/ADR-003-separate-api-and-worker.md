# ADR-003: Separate API and worker processes

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Background jobs (sync, embeddings, imports) must not block HTTP request latency.

## Decision

Run Fastify API and a dedicated Node worker process sharing packages and Redis.

## Consequences

Independent scaling and failure isolation for jobs. Slightly more Compose/process management.

## Alternatives considered

Inline jobs in API process; serverless queue consumers.
