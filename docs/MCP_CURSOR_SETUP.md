# Cursor MCP setup (Milestone 6)

Project Knowledge Hub exposes a **read-only** MCP endpoint:

```text
POST|GET|DELETE http://localhost:3101/mcp
Authorization: Bearer <api-client-token>
```

## 1. Create an API client

As a system administrator (session cookie), create a client:

```bash
curl -sS -X POST http://localhost:3101/api/v1/api-clients \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3100" \
  -H "Cookie: kh_session=<session>" \
  -d '{
    "organizationId": "<org-uuid>",
    "name": "Cursor local",
    "allowedWorkspaceIds": ["<workspace-uuid>"]
  }'
```

The response includes `token` **once**. Store it securely.

## 2. Cursor MCP configuration

Add to Cursor MCP settings (or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "project-knowledge-hub": {
      "url": "http://localhost:3101/mcp",
      "headers": {
        "Authorization": "Bearer kh_REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

## 3. Available tools

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records`
* `search_knowledge`
* `get_knowledge_record`
* `get_record_provenance`

Write tools are not exposed. Responses are size-limited; markdown may be truncated.
