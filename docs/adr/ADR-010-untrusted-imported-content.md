# ADR-010: Synchronized and imported content is untrusted

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Imported Markdown and conversation exports may contain scripts, dangerous URLs, or secrets.

## Decision

Treat all imported/synced content as untrusted: sanitize HTML, block script execution, reject dangerous URLs, and warn against storing secrets.

## Consequences

Safer rendering and MCP responses. Some rich HTML features are unavailable.

## Alternatives considered

Trust Git content; allow raw HTML passthrough.
