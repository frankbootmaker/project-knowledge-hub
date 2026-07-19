# ADR-014: Elevated API client capabilities (tiered, propose/confirm)

- **Status:** Accepted (design); Tier B not yet implemented
- **Date:** 2026-07-19
- **Related:** [ADR-005](ADR-005-read-only-mcp-first.md), [ADR-013](ADR-013-draft-only-write-mcp.md)

## Context

Trusted automation (AI / LLM agents) should eventually create and maintain catalogue structure—projects, systems, later workspaces—without human session cookies. Today API clients are limited to read scopes plus opt-in draft-only `knowledge:write` (ADR-013). Unrestricted “god mode” bearer tokens would be unsafe; a pure human-only catalogue also blocks useful agent workflows.

We need a path that is:

* **Safe** — least privilege, allowlists, audit, no hard wipe by default
* **LLM-friendly** — clear tools, structured errors, plan-then-act flow agents can follow

## Decision

### Capability tiers (scopes)

Elevate access only through **named opt-in scopes**. Default API client scopes remain read/search only.

| Tier | Scope(s) | Intent | Status |
|------|----------|--------|--------|
| A | `knowledge:write` | Draft create/update knowledge records | **Shipped** (ADR-013) |
| B | `catalogue:write` | Create/update projects and systems in allowlisted workspaces | **Next** |
| C | `workspace:write` | Create/update workspaces within an org allowlist | Later |
| D | `workspace:archive`, `catalogue:archive` | Soft-delete / archive only (no hard delete) | Later (UI archive/restore shipped for humans; MCP scopes deferred) |
| E | `org:admin` | Organization create/update — rare, separate client | Later / exceptional |

Rules for every elevated tier:

* Not in `DEFAULT_MCP_SCOPES`
* Requires `actingUserId` and a non-empty workspace allowlist (Tier C+ may add org allowlist)
* Mutations audit as `actorType: api_client` with full tool args in metadata
* Verify / mark-current / hard delete of knowledge remain out of MCP unless a future ADR adds a separate publish scope
* Hard delete of orgs/workspaces is **not** exposed to API clients; prefer archive + human transfer flows

### Propose → confirm → commit (LLM-friendly guardrail)

For Tier B and above, mutating tools use a two-phase protocol:

1. **`propose_*`** — validate inputs and allowlists; persist a short-lived **proposal** (id + hash of intended mutation); **no side effects** on catalogue rows.
2. **`commit_*`** — accept `proposalId` (and optional echoed `confirmationToken`); execute exactly that proposal once (idempotent via `clientMutationId` when provided).

Destructive or high-blast tools (Tier D+) additionally require an explicit confirmation field that echoes a stable name/slug (e.g. `confirmSlug`).

This matches how agents already work (plan, then act) and blocks one-shot destructive calls.

### Tier B tool surface (first implementation)

Gated by `catalogue:write` (+ existing read scopes as needed):

| Tool | Phase | Effect |
|------|-------|--------|
| `propose_create_project` / `commit_create_project` | propose / commit | Create project in allowlisted workspace |
| `propose_update_project` / `commit_update_project` | propose / commit | Update project fields |
| `propose_create_system` / `commit_create_system` | propose / commit | Create system |
| `propose_update_system` / `commit_update_system` | propose / commit | Update system fields |

Out of Tier B scope: archive/delete, workspace/org mutation, knowledge verify/publish.

### Client configuration (admin UI / API)

When scopes include `catalogue:write` (or higher):

* Enforce same write config gates as ADR-013: `actingUserId` + non-empty `allowedWorkspaceIds`
* Optional tighter `allowedProjectIds` when updating under a project
* Document in admin UI that the client can mutate catalogue structure
* Prefer **separate** API clients per agent/environment (e.g. `llm-staging` vs `llm-prod`)

### Rate limits and observability

* Keep per-client request rate limits; add stricter caps for commit tools (e.g. lower writes/minute)
* Audit `mcp.tool_call` / `llm.tool_call` for propose and commit; include `proposalId` on commit
* Future: admin activity filter for elevated scopes / commit actions

## Consequences

* Agents can automate project/system scaffolding without session cookies, under explicit allowlists
* Blast radius stays inside allowlisted workspaces; org and hard-delete remain human (or later gated tiers)
* Slightly more tools (propose + commit) — clearer for models than silent side effects
* Implementation needs a proposal store (DB table or Redis) with TTL and single-use commit

## Alternatives considered

* **Map API clients onto session `requireSystemAdmin` REST** — rejected; couples bearer tokens to cookie auth and grants org-wide power accidentally
* **Single `*:*` / “full admin” scope** — rejected; too easy to over-grant to an LLM
* **Direct commit tools without propose** — rejected for Tier B+; weak against tool-call hallucinations
* **Human approval queue for every create** — deferred; optional later flag on client (`requireHumanApproval`) for Tier C/D

## Implementation notes (Tier B)

1. Add `catalogue:write` to `MCP_SCOPES` and admin scope checklist
2. Proposal persistence + TTL + one-time commit
3. Wire MCP + `/api/v1/llm/tools/:toolName` with the same scope map
4. Reuse existing project/system service permission semantics via allowlist + acting user attribution
5. Update `docs/architecture/MCP_ARCHITECTURE.md`, `docs/MCP_CURSOR_SETUP.md`, and admin copy
6. Follow-up ADRs or changelog entries when Tier C/D/E ship
