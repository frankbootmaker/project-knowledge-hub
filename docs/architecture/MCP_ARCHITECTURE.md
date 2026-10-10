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

## OAuth resource (`/mcp/oauth`)

ChatGPT plugins and Codex use a second MCP URL. `/mcp` stays bearer-only for Cursor, Claude, Antigravity, Copilot, and OpenWebUI.

* KnowHub is the OAuth 2.1 authorization server (authorization code, PKCE S256, CIMD, refresh tokens). Human Authentik login only establishes the `kh_session` used on the consent page.
* Grants live in `oauth_grants`, not `api_clients`. Access tokens are short-lived JWTs whose `aud` is `https://<host>/mcp/oauth`.
* Discovery is path-scoped: `/.well-known/oauth-protected-resource/mcp/oauth`. The root `/.well-known/oauth-protected-resource` stays a JSON 404.
* The resource is off until `OAUTH_JWT_PRIVATE_KEY` is set and an admin enables it on **Admin → MCP setup**. Revoke grants from **Admin → API clients** or **Account → AI connections**.
* Audit actor type is `oauth_grant`. Closing a user revokes that user's grants.

## User setup wizard

Signed-in members use **Account → AI connections** (`/account/ai-connections`):

1. Preflight (`GET /api/v1/me/mcp/setup/preflight`) — health/ready + public MCP URL (no override).
2. Create client (`POST /api/v1/me/api-clients`) for workspaces they belong to; write mode sets `actingUserId` to self.
3. Optional connection test (`POST /api/v1/me/mcp/setup/test`).
4. Copy client schemas (Cursor, ChatGPT, Claude, …) via shared `McpClientSchemas`.

Rotate: `POST /api/v1/me/api-clients/:id/rotate` (owner only).

System admins keep `/admin/mcp-setup` for org-wide create, public URL override, and acting-as-another-user.

## AI autodiscover (pairing)

Agents can request an API client without the user using the wizard create path:

1. Active user mints a short-lived pairing code (`POST /api/v1/me/ai-pairing-codes`).
2. Agent reads `GET /api/v1/ai-discover` (and the public web page `/ai-discover`).
3. Agent creates a pending client with `POST /api/v1/ai-discover/requests` + pairing code.
4. The **requesting user** or a **system admin** approves (scopes / workspace allowlist).
5. Agent polls `GET /api/v1/ai-discover/requests/:id?claimSecret=` and receives the bearer token once.

Pending rows use `api_clients.status = pending_approval` with null token until approval. MCP auth only accepts `status = active`.

This pairing protocol is **optional / advanced** — mainstream clients (Cursor, ChatGPT, OpenWebUI, …) should use the Account or Admin setup wizard and paste Bearer configs.

**ChatGPT note:** Custom GPT **Actions** (OpenAPI + Bearer) still work inside that GPT. ChatGPT plugins and Codex use `/mcp/oauth` (OAuth 2.1). They do not accept a pasted `kh_` token. ChatGPT does not implement `/ai-discover` pairing.

## Scopes

Default (read): `projects:read`, `systems:read`, `knowledge:read`, `knowledge:search`, `provenance:read`

Opt-in write: `knowledge:write` — draft create/update knowledge records **and** workspace media upload/delete; requires non-empty `allowedWorkspaceIds` and `actingUserId`. Images: prefer `begin_workspace_media_upload` → `append_workspace_media_upload` → `finalize_workspace_media_upload` (ChatGPT Actions / large base64); or single-shot `upload_workspace_media` → embed `media.markdownSnippet` (never `data:` URIs); optional `insertIntoRecord` appends into a linked record.

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
