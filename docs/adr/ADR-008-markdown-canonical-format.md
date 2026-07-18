# ADR-008: Markdown as canonical record format

- **Status:** Accepted
- **Date:** 2026-07-19

## Context

Authors need a portable, diffable format that renders well for humans and agents.

## Decision

Store canonical content as Markdown; render sanitized HTML for display; optionally cache HTML.

## Consequences

Interoperable with Git docs and LLM outputs. Requires strict sanitization and Mermaid safety.

## Alternatives considered

HTML-only storage; proprietary rich-text JSON as sole source.
