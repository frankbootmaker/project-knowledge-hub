# MCP architecture

## Transport

* Official MCP TypeScript SDK
* Streamable HTTP at `/mcp`
* JSON response mode (`enableJsonResponse: true`) for Fastify compatibility

## Auth

* Long-lived API clients (`api_clients`)
* Bearer token hashed at rest (SHA-256)
* Scopes + optional workspace/project allowlists
* Optional `acting_user_id` (required for `knowledge:write`)

## AI autodiscover (pairing)

Agents can request an API client without an admin manually creating one first:

1. Active user mints a short-lived pairing code (`POST /api/v1/me/ai-pairing-codes`).
2. Agent reads `GET /api/v1/ai-discover` (and the public web page `/ai-discover`).
3. Agent creates a pending client with `POST /api/v1/ai-discover/requests` + pairing code.
4. The **requesting user** or a **system admin** approves (scopes / workspace allowlist).
5. Agent polls `GET /api/v1/ai-discover/requests/:id?claimSecret=` and receives the bearer token once.

Pending rows use `api_clients.status = pending_approval` with null token until approval. MCP auth only accepts `status = active`.

## Scopes

Default (read): `projects:read`, `systems:read`, `knowledge:read`, `knowledge:search`, `provenance:read`

Opt-in write: `knowledge:write` — draft create/update only; requires non-empty `allowedWorkspaceIds` and `actingUserId`

Elevated catalogue (planned): `catalogue:write` — propose/confirm create/update for projects and systems in allowlisted workspaces. See [ADR-014](../adr/ADR-014-elevated-api-client-capabilities.md). Higher tiers (`workspace:write`, archive, `org:admin`) are deferred.

## Limits

* 60 requests / minute / client (Redis)
* List/search capped at 25 items
* Content truncated at 50_000 characters
* Soft JSON response size cap ~200 KB

## Write guardrails

* MCP create/update always set lifecycle to `draft`
* Provenance defaults to `ai_generated_draft` / source provider `mcp`
* Updates require `changeMessage`
* Verify / mark-current / archive / restore are not exposed on MCP
* Elevated catalogue mutations (when shipped) use propose → commit; hard deletes stay off MCP

## Audit

* `mcp.request` per HTTP hit
* `mcp.tool_call` / `mcp.tool_error` per tool invocation
* Knowledge mutations from MCP audit as `actorType: api_client`
