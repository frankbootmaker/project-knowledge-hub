# @project-knowledge-hub/mcp

MCP server factory (Streamable HTTP) for Project Knowledge Hub.

## Tools (read)

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records` / `search_knowledge` / `get_knowledge_record`
* `get_record_provenance`
* `list_record_metadata` — field guides, allowed `recordType` values (incl. planning ledger types), lifecycle/SoT enums, MCP write constraints, **and the image/media embed workflow**
* `list_workspace_media` — recent workspace images with Markdown snippets
* `get_platform_status` — redacted health/backup snapshot (requires opt-in `monitoring:read`; not in default scopes)

Also available as REST: `GET /api/v1/platform/status` with the same scope.

## Tools (write, opt-in)

Require API client scope `knowledge:write` (not granted by default), a non-empty
workspace allowlist, and `actingUserId`:

* `create_knowledge_record` — always creates a **draft** with `ai_generated_draft` provenance
* `update_knowledge_record` — updates as **draft**; requires `changeMessage`
* `upload_workspace_media` — JPEG/PNG/WebP/GIF base64 upload; returns `media.markdownSnippet` for embeds; optional `insertIntoRecord` appends the snippet into a linked record
* `delete_workspace_media` — soft-delete media + remove bytes

Approve / mark-current remain human/session-API only.

## Embedding images in knowledge Markdown

Do **not** put `data:image/...;base64,...` URIs in `contentMarkdown`. Instead:

1. Call `upload_workspace_media` with `workspaceId`, `contentType`, and raw `contentBase64` (no `data:` prefix).
2. Either paste `media.markdownSnippet` (e.g. `![chart](/api/v1/media/{id})`) into `create_knowledge_record` / `update_knowledge_record`, **or** pass `knowledgeRecordId` + `insertIntoRecord: true` to append it automatically.
3. `get_knowledge_record` returns linked `media[]` metadata for that record.

Mounted by the API at `POST|GET|DELETE /mcp` with bearer API client tokens.
