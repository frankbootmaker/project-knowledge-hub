# ADR-001: Git and hub-managed content sources

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Technical knowledge originates from Git repositories, hub-authored docs, imports, and AI drafts. Forcing everything into Git would exclude infrastructure and conversation-derived knowledge.

## Decision

Support multiple source-of-truth modes (Git-managed, hub-managed, imported snapshot, AI draft, external authoritative) and display the mode on every record.

## Consequences

The data model and UI must surface provenance and editability rules. Git sync can arrive after hub-managed MVP content.

## Alternatives considered

Git-only wiki; Notion-like SaaS; file-system-only docs portal.
