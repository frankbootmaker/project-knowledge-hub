CREATE TABLE IF NOT EXISTS "llm_providers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "kind" text DEFAULT 'openai_compatible' NOT NULL,
  "base_url" text NOT NULL,
  "api_key" text,
  "default_model" text NOT NULL,
  "timeout_ms" integer,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "llm_providers_name_uidx" ON "llm_providers" ("name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_providers_status_idx" ON "llm_providers" ("status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "llm_service_bindings" (
  "service" text PRIMARY KEY NOT NULL,
  "provider_id" uuid NOT NULL,
  "model_override" text,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "llm_service_bindings"
    ADD CONSTRAINT "llm_service_bindings_provider_id_llm_providers_id_fk"
    FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "llm_providers"
    ADD CONSTRAINT "llm_providers_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "llm_service_bindings"
    ADD CONSTRAINT "llm_service_bindings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
