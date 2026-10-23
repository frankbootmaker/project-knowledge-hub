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
* The resource is off until `OAUTH_JWT_PRIVATE_KEY` is set and an admin enables it on **Admin → MCP setup → OAuth**. Revoke grants there or on **Account → AI connections**. Bearer clients stay on the Bearer tokens tab. Operator steps: [`docs/deployment/OAUTH_MCP_SETUP.md`](../deployment/OAUTH_MCP_SETUP.md).
* ChatGPT's tool scan stays small. `/mcp/oauth` lists only the navigation tools. Every other operation stays callable through `list_hub_tools` and `call_hub_tool`. Another OAuth client uses the same resource after its client-id prefix and redirect are allowlisted. User steps: [`docs/deployment/OAUTH_MCP_SETUP.md`](../deployment/OAUTH_MCP_SETUP.md) §5–6.
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

Opt-in write: `knowledge:write` — draft create/update knowledge records, PDF/DOCX import via `import_document_knowledge_record` (workspace maintainer; same type and size checks as the web import; returns `id`, `humanKey`, and `contentMarkdown`), **and** workspace media upload/delete; requires non-empty `allowedWorkspaceIds` and `actingUserId`. Images: prefer `begin_workspace_media_upload` → `append_workspace_media_upload` → `finalize_workspace_media_upload` (ChatGPT Actions / large base64); or single-shot `upload_workspace_media` → embed `media.markdownSnippet` (never `data:` URIs); optional `insertIntoRecord` appends into a linked record. Optional `targetEntityType` + `targetEntityId` links the new image to a delivery, RAID, or change item and also requires `pm:write`. `set_delivery_media_links` replaces that item's Media tab links (`pm:write`). Item reads return `mediaLinks` and `mediaLinkCount`. A workspace image link includes `mediaId`. `get_workspace_media` (`knowledge:read`) returns MCP image content for rasters (longest side at most 1568 px and about 1 MB, never upscaled) plus a 10-minute HMAC `signedUrl` that `GET /api/v1/media/:id` accepts without a session cookie. SVG and non-images return metadata only. Unsigned or expired cookieless requests stay rejected. A link never crosses workspaces, and unlinking does not delete the library file.

Elevated catalogue (planned): `catalogue:write` — propose/confirm create/update for projects and systems in allowlisted workspaces. See [ADR-014](../adr/ADR-014-elevated-api-client-capabilities.md). Higher tiers (`workspace:write`, archive, `org:admin`) are deferred.

## Limits

* 60 requests / minute / client (Redis)
* List/search capped at 25 items
* Content is paged at 50_000 characters (and about 100_000 UTF-8 bytes). `contentLength` is the full length and `contentSha256` hashes the whole body. `returnedChars`, `chunkIndex` (0-based page index: `ceil(contentOffset / contentLimit)` after the first page), and `totalChunks` describe the page (the counts are approximate when a page is shorter than the limit). When `contentTruncated` is true, call `get_knowledge_record` again with `contentOffset` set to `nextOffset` until `nextOffset` is null. When `contentOffset` or `contentLimit` is set, each page is a raw slice you can concatenate; the legacy `…[truncated]` suffix appears only on the default call with neither parameter. If the pretty-printed page would still exceed ~200 KB, the server halves the page and re-slices down to 1_000 characters instead of returning the size-limit error. A `contentOffset` that lands on the low half of a surrogate pair is moved back one unit so the page starts on a whole character. Tags, media, and `linkedItems` (delivery, RAID, and change links in the record’s project) are returned on the first page only. Archived rows are omitted. `boundary` may be `paragraph` or `line` to snap the cut; the default is a hard cut. `inCodeFence` is true when the page ends inside a code fence. Pass `expectSha256` to receive `409 CONTENT_CHANGED` when the stored body no longer matches.
* There is no separate `get_knowledge_record_content` tool. `get_knowledge_record` already returns the page, and a second tool would duplicate it. Later pages omit tags, media, and `linkedItems`, which is the content-only read.
* A body larger than one call can be written with `begin_record_content_upload` → `append_record_content` (max 40_000 characters, 500_000 total) → `finalize_record_content_upload`. That saves one draft version. Finalize returns `409 CONTENT_CHANGED` when the record changed after begin.
* `get_project`, `get_project_budget_summary`, and task rows return `baselineFinishDate` (approved finish), `forecastFinishDate` / `finishDate` (latest delivery finish), `durationWorkingDays` (inclusive working days; one working day is 1), and `forecastDurationWorkingDays` on the project and budget summary. Pinned charter and plan records include `humanKey` and `title`. Those ids accept a UUID or document key. Confirming an approved schedule change, `confirmBaseline: true`, and `apply_project_change_to_baseline` share one apply.
* Project lists page at 25 items (`limit` / `cursor` / `nextCursor` / `hasMore` / `total`): `list_project_tasks`, `list_my_project_tasks`, `list_project_milestones`, `list_project_epics`, `list_project_user_stories`, `list_project_sprints`, `list_project_raid_items`, `list_project_change_items`, and `list_project_task_activities`. Long descriptions, goals, rationale, and bug notes are excerpts. Task activity comments are full text unless `fullText` is false. The matching get tool returns the full text. `list_project_milestones` and `get_project_milestone` include derived `completionPercent` and `linkedItems`. `set_project_milestone_item_links` replaces those links.
* Soft JSON response size cap ~200 KB. A response that still exceeds it is an MCP tool error (`isError: true`) and includes `suggestedLimit` plus a paging hint.

## Write guardrails

* MCP create/update always set lifecycle to `draft`
* Provenance defaults to `ai_generated_draft` / source provider `mcp`
* Updates require `changeMessage`
* A content update that ends with the `get_knowledge_record` truncation marker is rejected. Page until `nextOffset` is null and send the full body.
* Verify / mark-current / archive / restore are not exposed on MCP
* Elevated catalogue mutations (when shipped) use propose → commit; hard deletes stay off MCP

## Audit

* `mcp.request` per HTTP hit
* `mcp.tool_call` / `mcp.tool_error` per tool invocation
* Knowledge mutations from MCP audit as `actorType: api_client`
