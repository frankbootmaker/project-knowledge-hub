# Document & image import (MarkItDown)

**Status:** implemented (inbound conversion slice)  
**Related:** M9 conversation import (paste), NF-013 workspace media, ADR-008 (Markdown canonical), ADR-010 (untrusted imports)

## Goal

Upload office/PDF/HTML/Markdown files or images, convert them to Markdown with [Microsoft MarkItDown](https://github.com/microsoft/markitdown), store extracted images as workspace media embeds, then create **draft** knowledge records.

`.md` / `.txt` / `.csv` uploads are decoded as UTF-8 and passed through (MarkItDown’s plain-text charset sniff only samples the first 4KiB and can mis-label UTF-8 files as ASCII).

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
| `DOCUMENT_IMPORT_DIR` | Local original storage when BlobStore is disabled. Relative paths resolve from the monorepo root (shared by API + worker). On Dokploy, use the absolute `/data/imports` path on the shared `knowledge_hub_data` volume (set by `compose.dokploy.yaml`). |
| `DOCUMENT_IMPORT_OCR_ENGINE` | Default OCR when the client omits `ocrEngine`: `none` \| `vision` \| `tesseract`. |
| `VISION_LLM_BASE_URL` / `VISION_LLM_API_KEY` / `VISION_LLM_MODEL` | OpenAI-compatible vision for `ocrEngine=vision` (set on **api/worker/web and** `kh-markitdown`). Ollama example: `http://host:11434/v1` + key `ollama` + a vision model. |
| `TESSERACT_LANG` | Fallback Tesseract primary language when the client omits `ocrLang` (`eng` \| `deu` \| `hun`). The import form defaults from the UI locale (`en`→`eng`, `de`→`deu`, `hu`→`hun`). Non-English runs use `{lang}+eng`. |

Local: `docker compose --profile markitdown up -d kh-markitdown` (or include with `--profile full`).

Dokploy: service is in `compose.dokploy.yaml` on the **project network only** (name `kh-markitdown`, never a generic alias on `dokploy-network`).

## OCR engines

Selected per upload in the Import UI (or via default env):

| Engine | Behavior |
| --- | --- |
| `none` | Native MarkItDown text extract only (no LLM, no Tesseract). |
| `vision` | `markitdown-ocr` + OpenAI-compatible vision model (Ollama or OpenAI). Best for photos / scanned PDFs when a vision model is available. |
| `tesseract` | Local Tesseract OCR on images and scanned PDF pages (no LLM). |

Health: `GET {MARKITDOWN_URL}/health` reports `vision`, `tesseract`, and available `engines`.

## UI entry

Workspace → **New import** → Documents or Images → choose OCR engine → upload → wait for status `ready` → **Create draft**.

## Out of scope (this slice)

- Azure Document Intelligence / Content Understanding
- Audio / YouTube / ZIP batch UI
- Merging with conversation-import package
- Doc Factory outbound templates
