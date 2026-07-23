# @project-knowledge-hub/mcp

MCP server factory (Streamable HTTP) for Project Knowledge Hub.

## Tools (read)

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records` / `search_knowledge` / `get_knowledge_record`
* `get_record_provenance`
* `list_record_metadata` — field guides, allowed `recordType` values (incl. planning ledger types), lifecycle/SoT enums, MCP write constraints
* `list_workspace_media` — recent workspace images with Markdown snippets

## Tools (write, opt-in)

Require API client scope `knowledge:write` (not granted by default), a non-empty
workspace allowlist, and `actingUserId`:

* `create_knowledge_record` — always creates a **draft** with `ai_generated_draft` provenance
* `update_knowledge_record` — updates as **draft**; requires `changeMessage`
* `upload_workspace_media` — JPEG/PNG/WebP base64 upload; returns `markdownSnippet` for embeds
* `delete_workspace_media` — soft-delete media + remove bytes

Verify / mark-current remain human/session-API only.

Mounted by the API at `POST|GET|DELETE /mcp` with bearer API client tokens.
