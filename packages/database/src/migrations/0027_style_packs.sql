CREATE TABLE IF NOT EXISTS "style_packs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "formats" jsonb DEFAULT '["pdf","docx"]'::jsonb NOT NULL,
  "typography" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "chrome" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "logo_blob_key" text,
  "logo_content_type" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "style_packs" ADD CONSTRAINT "style_packs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "style_packs" ADD CONSTRAINT "style_packs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "style_packs_organization_slug_uidx" ON "style_packs" USING btree ("organization_id","slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "style_packs_organization_status_idx" ON "style_packs" USING btree ("organization_id","status");
