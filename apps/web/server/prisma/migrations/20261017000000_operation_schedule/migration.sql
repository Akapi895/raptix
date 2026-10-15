-- W11 (ADR-0073): durable execution intents for scheduled operation starts.
-- The schedule references an existing engagement/thread/plan; it never
-- grants authority by itself — the dispatch path re-runs the execution gate.
CREATE TABLE "OperationSchedule" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "version" INTEGER NOT NULL DEFAULT 1,
    "executeAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "dispatchedAt" TIMESTAMP(3),
    "runId" TEXT,
    "outcomeDetail" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationSchedule_requestId_key" ON "OperationSchedule"("requestId");
CREATE INDEX "OperationSchedule_engagementId_status_idx" ON "OperationSchedule"("engagementId", "status");
