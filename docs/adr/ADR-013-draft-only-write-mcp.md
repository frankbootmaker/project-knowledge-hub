# ADR-013: Draft-only write-capable MCP

- **Status:** Accepted
- **Date:** 2026-07-19
- **Supersedes (partially):** [ADR-005](ADR-005-read-only-mcp-first.md) (writes no longer fully deferred)

## Context

Agents need to contribute knowledge without bypassing human verification. ADR-005 kept MCP read-only for the MVP; demand for agent authorship requires a controlled write path.

## Decision

Expose opt-in MCP write tools gated by `knowledge:write` (not in default API client scopes):

* `create_knowledge_record` / `update_knowledge_record`
* Always persist as `draft` with `sourceOfTruthMode: ai_generated_draft`
* Require non-empty workspace allowlist and `actingUserId` (user FK for `created_by`)
* Require `changeMessage` on updates
* Audit as `actorType: api_client`
* Verify / mark-current remain session/UI only

## Consequences

Agents can author drafts safely; humans retain lifecycle authority. Misconfigured write clients are rejected at create/update time.

## Alternatives considered

Full lifecycle write via MCP; session-cookie agent scripts without MCP tools.
