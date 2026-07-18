# ADR-012: Strix Halo as development environment

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Primary development occurs on the Strix Halo Ubuntu server alongside unrelated Docker workloads.

## Decision

Use isolated Compose project `knowledge-hub-dev`, localhost-bound data stores, reserved ports 3100/3101, and never modify existing container stacks under `/home/frankbootmaker/containers`.

## Consequences

Reduces collision risk with Open WebUI/Ollama/ComfyUI. Requires discipline around Docker commands.

## Alternatives considered

Develop only on local laptops; share networks/volumes with existing stacks.
