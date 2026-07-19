# @project-knowledge-hub/mcp

MCP server factory (Streamable HTTP) for Project Knowledge Hub.

## Tools (read)

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records` / `search_knowledge` / `get_knowledge_record`
* `get_record_provenance`

## Tools (write, opt-in)

Require API client scope `knowledge:write` (not granted by default), a non-empty
workspace allowlist, and `actingUserId`:

* `create_knowledge_record` — always creates a **draft** with `ai_generated_draft` provenance
* `update_knowledge_record` — updates as **draft**; requires `changeMessage`

Verify / mark-current remain human/session-API only.

Mounted by the API at `POST|GET|DELETE /mcp` with bearer API client tokens.
