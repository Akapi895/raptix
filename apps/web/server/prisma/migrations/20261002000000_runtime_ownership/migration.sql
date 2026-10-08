ALTER TABLE "Engagement" ADD COLUMN "runtimeContextLockedAt" TIMESTAMP(3);
CREATE TYPE "ThreadKind" AS ENUM ('planning', 'execution');
CREATE TYPE "WebRequestOperation" AS ENUM ('create_thread', 'create_run', 'resume');
CREATE TYPE "WebRequestState" AS ENUM ('creating', 'accepted', 'uncertain', 'rejected');

CREATE TABLE "EngagementThread" (
  "threadId" TEXT PRIMARY KEY,
  "engagementId" TEXT NOT NULL,
  "assistantId" TEXT NOT NULL,
  "kind" "ThreadKind" NOT NULL,
  "contextHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngagementThread_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EngagementThread_engagementId_threadId_key" ON "EngagementThread"("engagementId", "threadId");

CREATE TABLE "WebRequestLedger" (
  "id" TEXT PRIMARY KEY,
  "engagementId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "operation" "WebRequestOperation" NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "reservationToken" TEXT NOT NULL,
  "threadId" TEXT,
  "runId" TEXT,
  "activeThreadId" TEXT,
  "state" "WebRequestState" NOT NULL DEFAULT 'creating',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebRequestLedger_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebRequestLedger_engagementId_threadId_fkey" FOREIGN KEY ("engagementId", "threadId") REFERENCES "EngagementThread"("engagementId", "threadId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WebRequestLedger_active_binding_check" CHECK ("activeThreadId" IS NULL OR ("threadId" IS NOT NULL AND "activeThreadId" = "threadId")),
  CONSTRAINT "WebRequestLedger_operation_check" CHECK (("operation" = 'create_thread' AND "runId" IS NULL AND "activeThreadId" IS NULL) OR ("operation" <> 'create_thread' AND "threadId" IS NOT NULL)),
  CONSTRAINT "WebRequestLedger_acceptance_check" CHECK ("state" <> 'accepted' OR ("threadId" IS NOT NULL AND ("operation" = 'create_thread' OR "runId" IS NOT NULL)))
);
CREATE UNIQUE INDEX "WebRequestLedger_engagementId_requestId_key" ON "WebRequestLedger"("engagementId", "requestId");
CREATE UNIQUE INDEX "WebRequestLedger_activeThreadId_key" ON "WebRequestLedger"("activeThreadId");
CREATE UNIQUE INDEX "WebRequestLedger_threadId_runId_key" ON "WebRequestLedger"("threadId", "runId");
CREATE INDEX "WebRequestLedger_state_updatedAt_idx" ON "WebRequestLedger"("state", "updatedAt");
