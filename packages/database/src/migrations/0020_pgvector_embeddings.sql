CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS "embedding_models" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider" text NOT NULL,
  "model_name" text NOT NULL,
  "dimensions" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "embedding_models_provider_model_uidx"
  ON "embedding_models" ("provider", "model_name");

CREATE TABLE IF NOT EXISTS "knowledge_record_chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "knowledge_record_id" uuid NOT NULL REFERENCES "knowledge_records"("id") ON DELETE cascade,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "chunk_index" integer NOT NULL,
  "content" text NOT NULL,
  "token_estimate" integer,
  "embedding_model_id" uuid NOT NULL REFERENCES "embedding_models"("id") ON DELETE restrict,
  "embedding" vector(768) NOT NULL,
  "content_hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_record_chunks_record_index_uidx"
  ON "knowledge_record_chunks" ("knowledge_record_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "knowledge_record_chunks_workspace_id_idx"
  ON "knowledge_record_chunks" ("workspace_id");
CREATE INDEX IF NOT EXISTS "knowledge_record_chunks_record_id_idx"
  ON "knowledge_record_chunks" ("knowledge_record_id");
CREATE INDEX IF NOT EXISTS "knowledge_record_chunks_embedding_hnsw_idx"
  ON "knowledge_record_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
