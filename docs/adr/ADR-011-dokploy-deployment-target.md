# ADR-011: Dokploy as initial deployment target

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

The operator already uses Dokploy for container deployments and wants HTTPS-managed hosting.

## Decision

Package the app for Docker Compose/Dokploy deployment with health checks and persistent volumes.

## Consequences

Fits existing operations. Kubernetes and complex HA are deferred.

## Alternatives considered

Kubernetes-first; bare VM systemd-only; PaaS-only.
