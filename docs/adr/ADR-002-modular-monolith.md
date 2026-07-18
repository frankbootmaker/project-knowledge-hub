# ADR-002: Modular monolith architecture

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The product needs clear package boundaries without operational complexity of microservices on a single development host.

## Decision

Build one repository with apps (web/api/worker) and shared packages. Deploy as coordinated processes, not independent services.

## Consequences

Simpler local development, shared types, and atomic refactors. Avoids distributed transaction and network complexity in early milestones.

## Alternatives considered

Microservices from day one; modular monolith with separate repos.
