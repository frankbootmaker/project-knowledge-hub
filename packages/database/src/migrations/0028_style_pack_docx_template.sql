ALTER TABLE "style_packs" ADD COLUMN IF NOT EXISTS "docx_template_blob_key" text;
ALTER TABLE "style_packs" ADD COLUMN IF NOT EXISTS "docx_template_content_type" text;
ALTER TABLE "style_packs" ADD COLUMN IF NOT EXISTS "docx_template_body_anchor" text;
