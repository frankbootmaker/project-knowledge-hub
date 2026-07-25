ALTER TABLE "document_imports" ADD COLUMN IF NOT EXISTS "ocr_lang" text DEFAULT 'eng' NOT NULL;
