-- Typed many-to-many relations between knowledge records (PRO-T-24 / ADR-025).
-- Symmetric types (relates_to, contradicts) are stored once, from id < to id.
-- Deleting a record removes every incident edge. Safe to run again.

CREATE TABLE IF NOT EXISTS "knowledge_record_relations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "from_knowledge_record_id" uuid NOT NULL,
  "to_knowledge_record_id" uuid NOT NULL,
  "relation_type" text NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_workspace_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_from_record_id_fk"
    FOREIGN KEY ("from_knowledge_record_id") REFERENCES "knowledge_records"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_to_record_id_fk"
    FOREIGN KEY ("to_knowledge_record_id") REFERENCES "knowledge_records"("id")
    ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_created_by_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_distinct_chk"
    CHECK ("from_knowledge_record_id" <> "to_knowledge_record_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_type_chk"
    CHECK ("relation_type" IN (
      'relates_to',
      'depends_on',
      'refines',
      'derived_from',
      'contradicts'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "knowledge_record_relations"
    ADD CONSTRAINT "knowledge_record_relations_symmetric_order_chk"
    CHECK (
      "relation_type" NOT IN ('relates_to', 'contradicts')
      OR "from_knowledge_record_id" < "to_knowledge_record_id"
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_record_relations_uidx"
  ON "knowledge_record_relations" (
    "from_knowledge_record_id",
    "to_knowledge_record_id",
    "relation_type"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_relations_from_idx"
  ON "knowledge_record_relations" ("from_knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_relations_to_idx"
  ON "knowledge_record_relations" ("to_knowledge_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_relations_workspace_idx"
  ON "knowledge_record_relations" ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_record_relations_created_by_idx"
  ON "knowledge_record_relations" ("created_by");
