-- W19 follow-up: one curated import per retained producer path. The digest
-- pins the source bytes; a retry replays the existing draft only when those
-- bytes are unchanged. Existing duplicate producer refs must be reviewed
-- explicitly rather than silently deleted or merged during migration.
ALTER TABLE "FindingRecord" ADD COLUMN "producerDigest" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "FindingRecord"
    WHERE "producerRef" IS NOT NULL
    GROUP BY "engagementId", "producerRef"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate imported producer references exist; reconcile them before applying producer import identity migration.';
  END IF;
END $$;

CREATE UNIQUE INDEX "FindingRecord_engagementId_producerRef_key"
  ON "FindingRecord"("engagementId", "producerRef");
