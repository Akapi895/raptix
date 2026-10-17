-- Append-only finding workflow records. The version on each record pins the
-- exact finding revision that the actor read or produced.
CREATE TABLE "FindingComment" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "findingVersion" INTEGER NOT NULL,
  "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingComment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FindingComment_findingId_requestId_key" ON "FindingComment"("findingId", "requestId");
CREATE INDEX "FindingComment_findingId_createdAt_id_idx" ON "FindingComment"("findingId", "createdAt", "id");
CREATE INDEX "FindingComment_engagementId_createdAt_idx" ON "FindingComment"("engagementId", "createdAt");
ALTER TABLE "FindingComment" ADD CONSTRAINT "FindingComment_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "FindingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FindingHistory" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "findingVersion" INTEGER NOT NULL,
  "evidenceRefs" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingHistory_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FindingHistory_findingId_createdAt_id_idx" ON "FindingHistory"("findingId", "createdAt", "id");
CREATE INDEX "FindingHistory_engagementId_createdAt_idx" ON "FindingHistory"("engagementId", "createdAt");
ALTER TABLE "FindingHistory" ADD CONSTRAINT "FindingHistory_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "FindingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FindingRetest" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "findingVersion" INTEGER NOT NULL,
  "evidenceRefs" JSONB,
  "requestId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingRetest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FindingRetest_findingId_requestId_key" ON "FindingRetest"("findingId", "requestId");
CREATE INDEX "FindingRetest_findingId_createdAt_id_idx" ON "FindingRetest"("findingId", "createdAt", "id");
CREATE INDEX "FindingRetest_engagementId_createdAt_idx" ON "FindingRetest"("engagementId", "createdAt");
ALTER TABLE "FindingRetest" ADD CONSTRAINT "FindingRetest_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "FindingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FindingRecord" ADD COLUMN "assetId" TEXT, ADD COLUMN "bindingId" TEXT,
  ADD COLUMN "threadId" TEXT, ADD COLUMN "runId" TEXT, ADD COLUMN "techniqueId" TEXT, ADD COLUMN "contentUpdatedBy" TEXT;
ALTER TABLE "FindingRecord" ADD CONSTRAINT "FindingRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "WebAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FindingRecord" ADD CONSTRAINT "FindingRecord_bindingId_fkey" FOREIGN KEY ("bindingId") REFERENCES "OperationBinding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FindingRecord" ADD CONSTRAINT "FindingRecord_threadId_fkey" FOREIGN KEY ("engagementId", "threadId") REFERENCES "EngagementThread"("engagementId", "threadId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FindingRecord" ADD CONSTRAINT "FindingRecord_runId_fkey" FOREIGN KEY ("threadId", "runId") REFERENCES "WebRequestLedger"("threadId", "runId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "FindingSuggestionDisposition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "engagementId" TEXT NOT NULL REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL,
  "producerRef" TEXT NOT NULL,
  "dismissed" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "FindingSuggestionDisposition_engagementId_actorId_producerRef_key" ON "FindingSuggestionDisposition"("engagementId", "actorId", "producerRef");
CREATE INDEX "FindingSuggestionDisposition_engagementId_actorId_dismissed_idx" ON "FindingSuggestionDisposition"("engagementId", "actorId", "dismissed");
CREATE INDEX "FindingComment_findingId_findingVersion_id_idx" ON "FindingComment"("findingId", "findingVersion", "id");
CREATE INDEX "FindingHistory_findingId_findingVersion_id_idx" ON "FindingHistory"("findingId", "findingVersion", "id");
CREATE INDEX "FindingRetest_findingId_findingVersion_id_idx" ON "FindingRetest"("findingId", "findingVersion", "id");
