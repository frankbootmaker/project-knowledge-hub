# LLM / MCP client setup

For a guided in-app flow (platform checks → client → connection tests → client schemas):

* **Members:** Account → **AI connections** at `/account/ai-connections` (create a client for your workspaces, test, copy schemas).
* **System admins:** Admin → **LLM / MCP setup** at `/admin/mcp-setup` (org-wide options, public MCP URL override, acting-as-another-user).

The wizard’s final step exports configs for **Cursor**, **ChatGPT** (OpenAPI Actions), **Claude** (Desktop / Code / claude.ai remote MCP), **Antigravity CLI** (`agy`, consumer Google AI), **Gemini API** / enterprise Gemini CLI, **Microsoft Copilot Studio** (Swagger 2.0 MCP streamable), and **OpenWebUI** (native MCP or OpenAPI).

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

Clients that expect REST/OpenAPI (not MCP) use the public origin (`WEB_URL`), never the internal Compose API host:

```text
GET  {WEB_URL}/api/v1/llm/openapi.json
POST {WEB_URL}/api/v1/llm/tools/:toolName
Authorization: Bearer <api-client-token>
```

Tool names match MCP (`search_knowledge`, `get_knowledge_record`, …). The OpenAPI `servers[0].url` is derived from the resolved public MCP URL (override → `MCP_PUBLIC_URL` → `WEB_URL`).

### 3.1 ChatGPT Custom GPT (what works)

ChatGPT’s normal client does **not** use MCP. Wire Knowledge Hub as a **Custom GPT → Action** (Plus / Team / Enterprise). Verified on the Dokploy Dev host with both read and write (`knowledge:write`) creating draft knowledge records.

**User FAQ (setup, how to work, moving older chats into the hub):**  
[`docs/product/CHATGPT_CUSTOM_GPT_FAQ.md`](product/CHATGPT_CUSTOM_GPT_FAQ.md) — keep the Custom GPT path for now; normal-chat `@` / MCP App is backlog NF-004.

1. **Token** — Account → **AI connections** (`/account/ai-connections`): setup wizard → ChatGPT → create client (include `knowledge:write` if the GPT should create/update drafts). Copy the bearer token once.  
   System admins may instead use Admin → **LLM / MCP setup** (`/admin/mcp-setup`). Pairing under AI connections remains optional for agents that speak `/ai-discover`.
2. **Create a GPT** — ChatGPT → Explore GPTs → **Create** → **Configure** → **Actions** → **Create new action**.
3. **Import schema** — **Import from URL**:
   ```text
   https://<your-public-host>/api/v1/llm/openapi.json
   ```
   Example (Dev): `https://knowhub-dev.in3.technology/api/v1/llm/openapi.json`  
   The document must advertise the public HTTPS origin (not `http://api:3101`). Response schemas use `components.schemas.ToolResult` with explicit `properties` so ChatGPT’s Actions validator accepts the import.
4. **Authentication** — API Key, auth type **Bearer**, paste the hub token (no `Bearer ` prefix; ChatGPT adds it).
5. **Instructions** (optional) — e.g. search Knowledge Hub before answering; create/update only as drafts when write is enabled.
6. **Save** the GPT and chat **in that Custom GPT** (not the default ChatGPT thread, and not via `@` mention alone).

Humans use the web UI; Cursor, Antigravity CLI (`agy`), and other MCP clients use `/mcp`; ChatGPT uses the same ledger via OpenAPI Actions — one shared knowledge base across systems.

**Note:** Public `/mcp` must not be redirected to the login page by the web middleware (Bearer auth is enforced on the API). If MCP clients get `initialize` EOF / connection closed, check that `apps/web` lets `/mcp` through like `/api/*`. `/.well-known/*` must return JSON **404** (not a login HTML page) so proxies like `mcp-remote` do not crash parsing `<!DOCTYPE` during OAuth discovery.

### 3.2 Antigravity CLI (`agy`) on Windows

Antigravity often drops `headers` on remote `serverUrl` connections. Avoid `mcp-remote` (OAuth HTML crashes) and `supergateway` (crashes on Antigravity’s `server/discover`).

Use the repo’s **Bearer stdio proxy** (Node 20+, no extra packages):

1. Download [`scripts/mcp-bearer-stdio-proxy.mjs`](../../scripts/mcp-bearer-stdio-proxy.mjs) (or clone the repo).
2. Put this in `%USERPROFILE%\.gemini\config\mcp_config.json`:

```json
{
  "mcpServers": {
    "project-knowledge-hub": {
      "command": "node",
      "args": [
        "C:\\\\Users\\\\YOUR_USER\\\\AppData\\\\Local\\\\Temp\\\\mcp-bearer-stdio-proxy.mjs"
      ],
      "env": {
        "MCP_URL": "https://knowhub-dev.in3.technology/mcp",
        "MCP_TOKEN": "YOUR_HUB_TOKEN"
      }
    }
  }
}
```

3. `YOUR_HUB_TOKEN` is the raw hub token (no `Bearer ` prefix).
4. Fully quit `agy`, start again, `/mcp` reload.
5. Confirm the token with `curl` against `/mcp` first (expect MCP JSON, not 401).

Quick download (PowerShell):

```powershell
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/frankbootmaker/project-knowledge-hub/feature/m7-dokploy/scripts/mcp-bearer-stdio-proxy.mjs" `
  -OutFile "$env:TEMP\mcp-bearer-stdio-proxy.mjs"
```

## 4. Available tools

Read:

* `list_projects` / `get_project`
* `list_systems` / `get_system`
* `list_knowledge_records`
* `search_knowledge`
* `get_knowledge_record`
* `get_record_provenance`
* `list_record_metadata`

Write (requires `knowledge:write`):

* `create_knowledge_record` — always `draft` / `ai_generated_draft`
* `update_knowledge_record` — forces `draft`; requires `changeMessage`

Responses are size-limited; markdown may be truncated on read.
