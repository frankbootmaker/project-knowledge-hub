ALTER TABLE "document_imports" ADD COLUMN IF NOT EXISTS "ocr_engine" text DEFAULT 'none' NOT NULL;
