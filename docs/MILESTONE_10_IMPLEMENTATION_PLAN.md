# Milestone 10 — Semantic and hybrid search (implementation plan)

**Status:** First slice on `feature/m10-semantic-search`  
**Scope:** Optional embeddings + hybrid ranking; FTS remains default

## Objective

Improve retrieval when wording differs, without replacing PostgreSQL full-text search.

## Delivered (first slice)

* Postgres image `pgvector/pgvector:pg16` (Compose + CI)
* Migration `0020`: `vector` extension, `embedding_models`, `knowledge_record_chunks` (`vector(768)` + HNSW)
* Package `@project-knowledge-hub/embeddings`: disabled / ollama / openai_compatible providers, chunking, reindex helper
* Env: `EMBEDDING_*`, `SEARCH_HYBRID_ENABLED` (default provider **disabled**)
* BullMQ `embedding-reindex` queue + worker consumer
* Enqueue on knowledge create/update; `POST /api/v1/workspaces/:id/embeddings/reindex`
* Search `mode=fts|hybrid`, `GET /api/v1/search/capabilities`, UI hybrid checkbox, MCP `mode`

## Operator notes

* Pull the new Postgres image, then run migrations (`CREATE EXTENSION vector`).
* Do not `docker compose down -v` unless wiping data is intended.
* Column dimensions are fixed at **768** (nomic-embed-text). Changing `EMBEDDING_DIMENSIONS` requires a schema change + reindex.
* Hybrid only runs when `EMBEDDING_PROVIDER` is live **and** `SEARCH_HYBRID_ENABLED=true`.

## Out of scope (later)

* Admin UI for embedding settings (`platform_settings`)
* Full multi-model migration wizard
* Second vector store / dedicated search engine

## Validation

* `pnpm --filter @project-knowledge-hub/embeddings test`
* `pnpm --filter @project-knowledge-hub/search test`
* API search integration with `EMBEDDING_PROVIDER=disabled` (FTS unchanged)
