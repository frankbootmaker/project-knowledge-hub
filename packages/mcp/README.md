# @project-knowledge-hub/mcp

MCP server factory (Streamable HTTP) for Project Knowledge Hub.

## Tools (read)

* `list_workspaces` — id, name, and slug for allowlisted workspaces (ChatGPT: `call_hub_tool`, not a first-class Action)
* `list_projects` / `get_project` — include `workspaceName` and `workspaceSlug`; accept a workspace or project slug as well as a UUID
* `list_systems` / `get_system`
* `list_knowledge_records` / `search_knowledge` / `get_knowledge_record`
* `get_record_provenance`
* `list_record_metadata` — field guides, allowed `recordType` values (incl. planning ledger types), lifecycle/SoT enums, MCP write constraints, **and the image/media embed workflow**
* `list_workspace_media` — recent workspace images with Markdown snippets and `mediaId`; optional filter by a delivery, RAID, or change item
* `get_workspace_media` — read one image (`knowledge:read`). Raster types return MCP image content (longest side ≤ 1568 px, about 1 MB, never upscaled) plus metadata and a 10-minute HMAC `signedUrl`. SVG and non-images return metadata only. Animated images are the first frame. ChatGPT OAuth calls it through `call_hub_tool` so the listed tool scan stays under 12,000 characters.
* `get_platform_status` — redacted health/backup snapshot (requires opt-in `monitoring:read`; not in default scopes)
* `list_project_milestones` / `get_project_milestone` / `list_project_tasks` / `get_project_task` / `list_project_epics` / `list_project_user_stories` / `list_project_task_activities` / `list_project_stakeholders` / `list_project_raid_items` / `list_project_change_items` / `get_project_budget_summary` / `get_project_resource_utilization` — Project Delivery + RAID + budget/utilization (requires opt-in `pm:read`). Milestone list and get include `completionPercent` and `linkedItems`. Task, story, epic, milestone, sprint, RAID, and change reads include `mediaLinks` and `mediaLinkCount`. A workspace image link includes `mediaId` and a hint to call `get_workspace_media`. RAID list rows include `records[]`
* `list_project_sprints` / `get_project_sprint_burndown` / `get_project_scrum_velocity` — Scrum (NF-020)
* `list_my_project_tasks` / `get_my_dashboard_insights` — acting-user My tasks + dashboard rollups (`pm:read` + `actingUserId`)
* `list_project_delivery_document_links` — knowledge ↔ delivery index for a project
* `get_knowledge_record_delivery_links` — epic/story/task/**sprint** links for a knowledge record (`knowledge:read`; record id may be UUID or document key)
* `get_knowledge_record_relations` — typed record↔record relations plus lifecycle successor/predecessor (`knowledge:read`; record id may be UUID or document key). `get_knowledge_record` also returns compact `recordRelations` unless `includeRecordRelations` is false

Also available as REST: `GET /api/v1/platform/status` with the same scope.

## Tools (write, opt-in)

### Knowledge (`knowledge:write`)

Require API client scope `knowledge:write` (not granted by default), a non-empty
workspace allowlist, and `actingUserId`:

* `create_knowledge_record` — always creates a **draft** with `ai_generated_draft` provenance
* `import_document_knowledge_record` — import a PDF or DOCX (or other document-lane file) as a **draft** Markdown record. Pass `contentBase64` + `filename` + `contentType`, or `mediaId` of a file already stored in the workspace. Optional `projectId`, `title`, `recordType` (default `note`), and `language`. The acting user must be a workspace maintainer. Same type and size checks as the web import (`DOCUMENT_IMPORT_MAX_BYTES`, default 25 MiB). Conversion uses the shared MarkItDown pipeline and returns `id`, `humanKey` / `key`, and `contentMarkdown`. Validation errors are `isError` with a `CODE: message` text (`DOCUMENT_IMPORT_TYPE_UNSUPPORTED`, `DOCUMENT_IMPORT_TOO_LARGE`, `FORBIDDEN`). ChatGPT calls it through `call_hub_tool`.
* `update_knowledge_record` — updates as **draft**; requires `changeMessage`
* `set_knowledge_record_delivery_links` — replace epic/story/task/**sprint** links (record must be project-scoped; entity ids may be human keys)
* `set_knowledge_record_relations` — replace relations stored from a record (`relates_to`, `depends_on`, `refines`, `derived_from`, `contradicts`). Does not change lifecycle. Rejects cycles on `depends_on` and `refines`
* `begin_workspace_media_upload` / `append_workspace_media_upload` / `finalize_workspace_media_upload` — Redis-backed chunked base64 upload (**preferred for ChatGPT Actions**; ~8 KB chunks). Optional `targetEntityType` + `targetEntityId` (UUID or human key) links the image on finalize and also requires `pm:write`
* `upload_workspace_media` — single-shot JPEG/PNG/WebP/GIF base64 upload; returns `media.markdownSnippet`; optional `insertIntoRecord`; optional target item (same `pm:write` rule)
* `delete_workspace_media` — soft-delete media + remove bytes

Approve / mark-current remain human/session-API only.

### Project Delivery (`pm:write`) — live state (ADR-015 / ADR-019 / ADR-022)

Require `pm:write`, workspace allowlist, and `actingUserId`. Unlike knowledge writes, these **commit immediately** (not draft-only):

* `create_project_milestone` / `update_project_milestone` / `set_project_milestone_item_links` — due date is `targetDate`; `description` is the note; links are epics, stories, tasks, and bugs (`task`)
* `create_project_epic` / `update_project_epic`
* `create_project_user_story` / `update_project_user_story`
* `create_project_sprint` / `update_project_sprint` — activate/close; unfinished work → backlog or another sprint
* `create_project_task` / `update_project_task` (optional story + sprint + points + current owner; optional `tokensUsed` or `tokensInput`/`tokensOutput`/`tokensCache`, plus `aiSystemId`)
* `report_project_task_ai_usage` — record AI tokens on a task (prefer on completion); send `modelId`; priced from the model catalog (per 1,000,000 tokens); a model with no row is unpriced; optional `cloudAgentIds` replaces the cloud-agent links (the same id may be on several tasks; imported usage is stored once and split in equal whole tokens); `cloudAgentId` sets one link when the list is omitted; refreshes cost snapshot
* `list_ai_usage_imports` — read the workspace usage-import log (`pm:read`)
* `import_ai_usage_csv` — import Cursor usage CSV text (`pm:write` and workspace administrator). Dedupes on Date + Cloud Agent ID + Model + Total Tokens. The Admin API source is not available.
* `set_project_task_raci` — replace RACI; workspace members only; at most one Accountable (`A`)
* `add_project_task_comment` / `handoff_project_task` — activity timeline; handoff moves current owner only
* `create_project_stakeholder` / `update_project_stakeholder` / `delete_project_stakeholder` — durable roster (+ reports-to, engagement, capacity, contract)
* `update_project_ai_assistant_cost` — AI cost mode (`flat`|`api`|`mixed`|`note_only`), flat fee, `aiCostNotes`, soft allocation. Token prices are `upsert_ai_model_price` (per 1,000,000 tokens). Per-1k system rate fields return `TOKEN_RATES_RETIRED`.
* `create_project_raid_item` / `update_project_raid_item` / `set_project_raid_task_links` — RAID register (+ task links; create accepts optional `recordIds`)
* `transfer_project_raid_item` — move risk↔issue (new key; archives source). Do not use `update_project_raid_item` to change kind between risk and issue.
* `create_project_change_item` / `update_project_change_item` — change register (+ delivery links; entity/knowledge ids may be human keys)
* `set_delivery_media_links` — replace Media tab links (workspace image or titled http(s) URL) on a task, bug (`task`), story, epic, milestone, sprint, RAID, or change item. `entityId` may be a UUID or human key. Omitting a link unlinks it and does not delete the library file. Same workspace only
* `update_project_baseline` — dates, pins, DoD, currency, budgets, and optional `keyPrefix` (workspace-unique `AAA` / `AA0`). The response includes the saved `definitionOfDone`.
* `move_project` — move a project to another workspace. Same organization requires both workspaces on the allowlist. Another organization requires `confirmCrossOrganization` (Git tokens and conversation imports travel with the project) and the client cannot keep the destination on its allowlist, so it loses access after the move. `dryRun` returns conflicts without writing.

**Human keys:** Delivery, RAID, change, and knowledge DTOs include `humanKey` (e.g. `HL1-T-12`, `HL1-RR-3`, `HL1-VIS-2`). Get/update tools accept **UUID or human key** for entity and document ids. `get_project` returns `keyPrefix` and `definitionOfDone`. Setup wizards can opt into `pm:read` / `pm:write`.

**AI spend:** When an AI system worked a task, call `report_project_task_ai_usage` (or set tokens on create/update) and send `modelId`. Tokens are priced from the model catalog (workspace pattern, then global, per 1,000,000 tokens). `tokensUsed` alone uses the blended catalog rate. `tokensInput` / `tokensOutput` / `tokensCache` / `tokensCacheWrite` use the split rates. A model with no row is unpriced and listed, not a silent zero. That product is the theoretical API cost. `get_project_budget_summary` returns it as `aiTheoreticalApiCost` and does not add it to AC when the month is covered by the billing ledger. A Cursor usage CSV can be imported with `import_ai_usage_csv` (workspace administrator). Set `cloudAgentIds` on the task first (or one `cloudAgentId`). The same id may be linked to several tasks. Those rows are stored once and split in equal whole tokens across the linked tasks (remainder to the earliest task id), so re-importing does not add the rows again and summing the task counters does not double count the run. Reads return `cloudAgentIds` and `cloudAgentLinks`.

Paid AI cost is `aiPaidAc` (also `aiAc`). A system administrator can read every workspace at once with `get_platform_ai_cost` (via `call_hub_tool`, not a first-class Action): paid cost by type, theoretical API cost, difference, and ratio, per currency, defaulting to the last 12 months. Currencies are not combined. Multi-month entries use the same day split as a workspace chart. Record a workspace entry with `create_ai_billing_entry` / `update_ai_billing_entry` / `delete_ai_billing_entry` / `list_ai_billing_entries`: `subscription`, `plan_change` (amount may be negative), or `on_demand`, many rows per `YYYY-MM`. Optional `servicePeriodStart` (inclusive) and `servicePeriodEnd` (exclusive renewal date, not included) prorate one row across those months by days. Days are end minus start, end must be after start, and a one-day entry has end = start + 1. `period` is then the start month. Omit both dates to keep the whole amount in `period`. A workspace-wide row (no `aiSystemId`) is one pool; a row with `aiSystemId` is that system's pool. The pool is split across projects by token usage in that month, or equally across active projects when nobody used tokens, or by a manual percent (`PUT /api/v1/workspaces/:id/ai-billing-allocations`, at most 100). Shares sum to the pool and are not counted twice. A month with no ledger rows keeps `aiFlatMonthlyFee` accrued over the project dates, plus token cost for `api` / `mixed`, so existing projects stay the same until an entry exists. `flat` bills only that fee. `note_only` records usage at $0. `modelId`, `pricingTier`, `usageOccurredAt`, and `billingPeriod` tag the usage; the period (or the UTC month of `usageOccurredAt`) places tokens in the allocation.

## Embedding images in knowledge Markdown

Do **not** put `data:image/...;base64,...` URIs in `contentMarkdown`. Instead:

1. **ChatGPT Actions:** `begin_workspace_media_upload` → split raw base64 into ~8000-char chunks → `append_workspace_media_upload` each → `finalize_workspace_media_upload`.
2. **Single-shot (small files):** `upload_workspace_media` with `workspaceId`, `contentType`, and raw `contentBase64` (no `data:` prefix).
3. Either paste `media.markdownSnippet` (e.g. `![chart](/api/v1/media/{id})`) into `create_knowledge_record` / `update_knowledge_record`, **or** pass `knowledgeRecordId` + `insertIntoRecord: true` on begin/upload to append it automatically.
4. To attach the image to a delivery item in the same step, pass `targetEntityType` + `targetEntityId` on begin (or on the single-shot upload). That also requires `pm:write`. PDF and Office files are documents, not media.
5. `get_knowledge_record` and `list_knowledge_records` return `tags` as a string array of tag names (same shape as `search_knowledge`). `get_knowledge_record` also returns linked `media[]` metadata and, on the first page, `linkedItems` (`deliveryLinks`, `raidLinks`, `changeItems`) for the same project. Archived rows are omitted. Compact `recordRelations` (counts plus up to 20 summaries) is included on every page unless `includeRecordRelations` is false.
6. To show an embedded image to the model, call `get_workspace_media` with the id from `/api/v1/media/{id}` or from `mediaLinks[].mediaId`. The relative URL still needs a session cookie. `signedUrl` does not. On the ChatGPT OAuth surface, call it through `call_hub_tool`.

Mounted by the API at `POST|GET|DELETE /mcp` with bearer API client tokens.

## MCP schema conventions

* **Tool inputs** — strict JSON Schema (`additionalProperties: false` at each object). Unknown argument keys are rejected before handlers run.
* **Tool outputs** — open JSON Schema at every object depth so clients that cache `tools/list` keep validating responses after deploys add fields. The server still strips `structuredContent` to the declared Zod output shape via `stripToSchema`.
