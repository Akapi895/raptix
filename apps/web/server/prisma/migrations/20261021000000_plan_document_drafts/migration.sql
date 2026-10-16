-- O06 (ADR-0083): persistent plan document drafts keyed by engagement and
-- allowlisted document name. baseDigest pins the published bytes the editor
-- loaded so publish can refuse a stale base.
CREATE TABLE "PlanDocumentDraft" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseDigest" TEXT,
    "body" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanDocumentDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanDocumentDraft_engagementId_name_key" ON "PlanDocumentDraft"("engagementId", "name");
CREATE INDEX "PlanDocumentDraft_engagementId_updatedAt_idx" ON "PlanDocumentDraft"("engagementId", "updatedAt");

ALTER TABLE "PlanDocumentDraft" ADD CONSTRAINT "PlanDocumentDraft_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
