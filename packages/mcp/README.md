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
* `list_project_milestones` / `list_project_tasks` / `get_project_task` / `list_project_epics` / `list_project_user_stories` / `list_project_task_activities` / `list_project_stakeholders` / `list_project_raid_items` — Project Delivery + RAID (requires opt-in `pm:read`)
* `get_knowledge_record_delivery_links` — epic/story/task links for a knowledge record (`knowledge:read`)

Also available as REST: `GET /api/v1/platform/status` with the same scope.

## Tools (write, opt-in)

### Knowledge (`knowledge:write`)

Require API client scope `knowledge:write` (not granted by default), a non-empty
workspace allowlist, and `actingUserId`:

* `create_knowledge_record` — always creates a **draft** with `ai_generated_draft` provenance
* `update_knowledge_record` — updates as **draft**; requires `changeMessage`
* `set_knowledge_record_delivery_links` — replace epic/story/task links (record must be project-scoped)
* `begin_workspace_media_upload` / `append_workspace_media_upload` / `finalize_workspace_media_upload` — Redis-backed chunked base64 upload (**preferred for ChatGPT Actions**; ~8 KB chunks)
* `upload_workspace_media` — single-shot JPEG/PNG/WebP/GIF base64 upload; returns `media.markdownSnippet`; optional `insertIntoRecord`
* `delete_workspace_media` — soft-delete media + remove bytes

Approve / mark-current remain human/session-API only.

### Project Delivery (`pm:write`) — live state (ADR-015)

Require `pm:write`, workspace allowlist, and `actingUserId`. Unlike knowledge writes, these **commit immediately** (not draft-only):

* `create_project_milestone` / `update_project_milestone`
* `create_project_epic` / `update_project_epic`
* `create_project_user_story` / `update_project_user_story`
* `create_project_task` / `update_project_task` (optional story + current owner)
* `set_project_task_raci` — replace RACI; workspace members only; at most one Accountable (`A`)
* `add_project_task_comment` / `handoff_project_task` — activity timeline; handoff moves current owner only
* `create_project_stakeholder` / `update_project_stakeholder` / `delete_project_stakeholder` — durable roster (+ reports-to)
* `create_project_raid_item` / `update_project_raid_item` / `set_project_raid_task_links` — RAID register (+ task links)

## Embedding images in knowledge Markdown

Do **not** put `data:image/...;base64,...` URIs in `contentMarkdown`. Instead:

1. **ChatGPT Actions:** `begin_workspace_media_upload` → split raw base64 into ~8000-char chunks → `append_workspace_media_upload` each → `finalize_workspace_media_upload`.
2. **Single-shot (small files):** `upload_workspace_media` with `workspaceId`, `contentType`, and raw `contentBase64` (no `data:` prefix).
3. Either paste `media.markdownSnippet` (e.g. `![chart](/api/v1/media/{id})`) into `create_knowledge_record` / `update_knowledge_record`, **or** pass `knowledgeRecordId` + `insertIntoRecord: true` on begin/upload to append it automatically.
4. `get_knowledge_record` returns linked `media[]` metadata for that record.

Mounted by the API at `POST|GET|DELETE /mcp` with bearer API client tokens.
