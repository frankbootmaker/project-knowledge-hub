# LLM / MCP client setup

For a guided in-app flow (platform checks → client → connection tests → client schemas), open **Admin → LLM / MCP setup** at `/admin/mcp-setup` while signed in as a system administrator.

The wizard’s final step exports configs for **Cursor**, **ChatGPT** (OpenAPI Actions), **Gemini** (MCP + OpenAPI + functionDeclarations), **Microsoft Copilot Studio** (Swagger 2.0 MCP streamable), and **OpenWebUI** (native MCP or OpenAPI).

The Cursor config URL defaults to `{WEB_URL}/mcp` (same-origin via the web reverse rewrite). For a different public host, set optional env `MCP_PUBLIC_URL`, or save a **public MCP URL override** in the wizard (stored in platform settings). Connection tests still use the internal `API_URL`. Never advertise internal Compose hosts (e.g. `http://api:3101`) to external LLM clients.

Project Knowledge Hub exposes MCP at:

```text
POST|GET|DELETE http://localhost:3101/mcp
Authorization: Bearer <api-client-token>
```

## 1. Create an API client

As a system administrator (session cookie), create a **read** client:

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

### Write-capable client (optional)

To let agents create/update **draft** records, grant `knowledge:write`, set `actingUserId`, and keep a non-empty workspace allowlist:

```bash
curl -sS -X POST http://localhost:3101/api/v1/api-clients \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3100" \
  -H "Cookie: kh_session=<session>" \
  -d '{
    "organizationId": "<org-uuid>",
    "name": "Cursor writer",
    "scopes": [
      "projects:read",
      "systems:read",
      "knowledge:read",
      "knowledge:search",
      "provenance:read",
      "knowledge:write"
    ],
    "allowedWorkspaceIds": ["<workspace-uuid>"],
    "actingUserId": "<user-uuid>"
  }'
```

`actingUserId` is stored as `created_by` on records/versions. Verify and mark-current stay human-only in the UI/API.

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

## 3. OpenAPI facade (ChatGPT, OpenWebUI, Gemini OpenAPI)

Clients that expect REST/OpenAPI (not MCP) can use:

```text
GET  {API_URL}/api/v1/llm/openapi.json
POST {API_URL}/api/v1/llm/tools/:toolName
Authorization: Bearer <api-client-token>
```

Tool names match MCP (`search_knowledge`, `get_knowledge_record`, …). The public OpenAPI document is generated from the same public MCP host resolution (override → `MCP_PUBLIC_URL` → `API_URL`).

## 4. Available tools

Read:

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records`
* `search_knowledge`
* `get_knowledge_record`
* `get_record_provenance`

Write (requires `knowledge:write`):

* `create_knowledge_record` — always `draft` / `ai_generated_draft`
* `update_knowledge_record` — forces `draft`; requires `changeMessage`

Responses are size-limited; markdown may be truncated on read.
