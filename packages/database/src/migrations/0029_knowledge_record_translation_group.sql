ALTER TABLE "knowledge_records" ADD COLUMN IF NOT EXISTS "translation_group_id" uuid;
CREATE INDEX IF NOT EXISTS "knowledge_records_translation_group_id_idx"
  ON "knowledge_records" ("translation_group_id");
