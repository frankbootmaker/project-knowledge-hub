ALTER TABLE "knowledge_records" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
  setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("record_type", '')), 'B') ||
  setweight(to_tsvector('english', coalesce("content_markdown", '')), 'C')
) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_records_search_vector_idx" ON "knowledge_records" USING gin ("search_vector");
