ALTER TABLE "ProjectFact"
  ADD COLUMN "verificationState" TEXT NOT NULL DEFAULT 'observed',
  ADD COLUMN "verificationSource" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedBy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "ProjectFact_id_projectId_key" ON "ProjectFact"("id", "projectId");
CREATE INDEX "ProjectFact_projectId_verificationState_idx" ON "ProjectFact"("projectId", "verificationState");
ALTER TABLE "ProjectFact" ADD CONSTRAINT "ProjectFact_verificationState_check"
  CHECK ("verificationState" IN ('observed','proposed','verified','rejected','stale'));
CREATE TABLE "ProjectFactEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "factId" TEXT NOT NULL,
  "engagement" TEXT NOT NULL,
  "akgObservationKind" TEXT NOT NULL,
  "akgObservationKey" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "provenanceChannel" TEXT NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "snapshotHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFactEvidence_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectFactEvidence_factId_projectId_fkey" FOREIGN KEY ("factId", "projectId") REFERENCES "ProjectFact"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fact_evidence_snapshot_key" ON "ProjectFactEvidence"("factId", "akgObservationKind", "akgObservationKey", "snapshotHash");
CREATE INDEX "fact_evidence_project_identity_idx" ON "ProjectFactEvidence"("projectId", "akgObservationKind", "akgObservationKey");
CREATE TABLE "ProjectFactVerification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "factId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "fromState" TEXT NOT NULL,
  "toState" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "factRevision" INTEGER NOT NULL,
  "snapshotJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFactVerification_factId_projectId_fkey" FOREIGN KEY ("factId", "projectId") REFERENCES "ProjectFact"("id", "projectId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectFactVerification_factId_factRevision_key" ON "ProjectFactVerification"("factId", "factRevision");
