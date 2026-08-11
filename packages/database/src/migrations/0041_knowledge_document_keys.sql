ALTER TABLE "knowledge_records"
  ADD COLUMN IF NOT EXISTS "document_key_type" text;
--> statement-breakpoint
ALTER TABLE "knowledge_records"
  ADD COLUMN IF NOT EXISTS "document_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_records_project_doc_key_uidx"
  ON "knowledge_records" ("project_id", "document_key_type", "document_number")
  WHERE "project_id" IS NOT NULL
    AND "document_key_type" IS NOT NULL
    AND "document_number" IS NOT NULL;
--> statement-breakpoint

-- Backfill document keys for existing project-scoped records (by created_at).
DO $$
DECLARE
  rec RECORD;
  code text;
  next_n integer;
  counters jsonb;
BEGIN
  FOR rec IN
    SELECT
      kr.id,
      kr.project_id,
      kr.record_type,
      kr.created_at
    FROM knowledge_records kr
    WHERE kr.project_id IS NOT NULL
      AND kr.document_number IS NULL
    ORDER BY kr.project_id, kr.record_type, kr.created_at ASC, kr.id ASC
  LOOP
    code := CASE rec.record_type
      WHEN 'overview' THEN 'OV'
      WHEN 'architecture' THEN 'ARCH'
      WHEN 'deployment-guide' THEN 'DEP'
      WHEN 'installation-guide' THEN 'INST'
      WHEN 'configuration' THEN 'CFG'
      WHEN 'configuration-snapshot' THEN 'CFGS'
      WHEN 'runbook' THEN 'RB'
      WHEN 'troubleshooting' THEN 'TS'
      WHEN 'incident-resolution' THEN 'INC'
      WHEN 'migration-guide' THEN 'MIG'
      WHEN 'decision' THEN 'DEC'
      WHEN 'project-charter' THEN 'CHR'
      WHEN 'meeting-minutes' THEN 'MM'
      WHEN 'lessons-learned' THEN 'LL'
      WHEN 'command-reference' THEN 'CMD'
      WHEN 'inventory' THEN 'INV'
      WHEN 'status' THEN 'STA'
      WHEN 'management-summary' THEN 'MSUM'
      WHEN 'progress-summary' THEN 'PSUM'
      WHEN 'roadmap' THEN 'RM'
      WHEN 'recovery-guide' THEN 'RCV'
      WHEN 'backup-guide' THEN 'BAK'
      WHEN 'security-note' THEN 'SEC'
      WHEN 'integration-guide' THEN 'INTG'
      WHEN 'conversation-summary' THEN 'CONV'
      WHEN 'research-note' THEN 'RES'
      WHEN 'proposal' THEN 'PROP'
      WHEN 'business-idea' THEN 'IDEA'
      WHEN 'vision' THEN 'VIS'
      WHEN 'plan' THEN 'PLN'
      WHEN 'initiative' THEN 'INIT'
      WHEN 'invoice' THEN 'INVC'
      WHEN 'note' THEN 'NOTE'
      WHEN 'sprint_retrospective' THEN 'RET'
      WHEN 'sprint_review' THEN 'REV'
      ELSE 'OTH'
    END;

    SELECT issue_counters INTO counters
    FROM projects
    WHERE id = rec.project_id
    FOR UPDATE;

    next_n := COALESCE((counters ->> code)::integer, 0) + 1;
    counters := jsonb_set(
      COALESCE(counters, '{}'::jsonb),
      ARRAY[code],
      to_jsonb(next_n),
      true
    );

    UPDATE projects
    SET issue_counters = counters, updated_at = now()
    WHERE id = rec.project_id;

    UPDATE knowledge_records
    SET document_key_type = code, document_number = next_n
    WHERE id = rec.id;
  END LOOP;
END $$;
