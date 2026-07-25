# Document & image import (MarkItDown)

**Status:** implemented (inbound conversion slice)  
**Related:** M9 conversation import (paste), NF-013 workspace media, ADR-008 (Markdown canonical), ADR-010 (untrusted imports)

## Goal

Upload office/PDF/HTML/Markdown files or images, convert them to Markdown with [Microsoft MarkItDown](https://github.com/microsoft/markitdown), store extracted images as workspace media embeds, then create **draft** knowledge records.

This is **inbound ingest**, not Doc Factory (outbound PDF/DOCX export).

## Architecture

| Piece | Role |
| --- | --- |
| `kh-markitdown` Compose service | FastAPI sidecar: `POST /convert` → Markdown + image attachments |
| API `POST /api/v1/document-imports` | Multipart upload → BlobStore/`DOCUMENT_IMPORT_DIR` → BullMQ job |
| Worker `document-import-convert` | Calls MarkItDown, writes `workspace_media`, rewrites `attachment:N` → `/api/v1/media/:id` |
| Web Import picker | **Documents** and **Images** lanes → upload → detail (poll) → create draft |

Trust boundary (same as conversation imports):

- Originals are **not** MCP/FTS indexed.
- Drafts use `sourceType: 'import'`, `sourceOfTruthMode: 'imported_snapshot'`.
- Secret-pattern warnings reuse `@project-knowledge-hub/conversation-import` detectors.

## Env

| Variable | Purpose |
| --- | --- |
| `MARKITDOWN_URL` | Sidecar base URL (e.g. `http://kh-markitdown:8080`). Empty = feature disabled. |
| `MARKITDOWN_TIMEOUT_MS` | Convert timeout (default 120000). |
| `DOCUMENT_IMPORT_MAX_BYTES` | Upload size limit (default 25 MiB). |
| `DOCUMENT_IMPORT_DIR` | Local original storage when BlobStore is disabled. Relative paths resolve from the monorepo root (shared by API + worker). |
| `VISION_LLM_BASE_URL` / `VISION_LLM_API_KEY` / `VISION_LLM_MODEL` | Optional OpenAI-compatible vision for image captions (set on **api/worker and** `kh-markitdown`). |

Local: `docker compose --profile markitdown up -d kh-markitdown` (or include with `--profile full`).

Dokploy: service is in `compose.dokploy.yaml` on the **project network only** (name `kh-markitdown`, never a generic alias on `dokploy-network`).

## UI entry

Workspace → **New import** → Documents or Images → upload → wait for status `ready` → **Create draft**.

## Out of scope (this slice)

- Azure Document Intelligence / markitdown-ocr plugins beyond OpenAI-compatible vision
- Audio / YouTube / ZIP batch UI
- Merging with conversation-import package
- Doc Factory outbound templates
