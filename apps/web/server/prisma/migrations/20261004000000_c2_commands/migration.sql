CREATE TABLE "C2Command" (
 "id" TEXT NOT NULL, "engagementId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL, "path" TEXT NOT NULL, "args" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'creating',
 "exitCode" INTEGER, "pid" INTEGER, "stdout" TEXT NOT NULL DEFAULT '', "stderr" TEXT NOT NULL DEFAULT '',
 "stdoutTruncated" BOOLEAN NOT NULL DEFAULT false, "stderrTruncated" BOOLEAN NOT NULL DEFAULT false,
 "activeSessionId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "C2Command_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "C2Command_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "C2Command_engagementId_requestId_key" ON "C2Command"("engagementId", "requestId");
CREATE UNIQUE INDEX "C2Command_activeSessionId_key" ON "C2Command"("activeSessionId");
CREATE INDEX "C2Command_engagementId_createdAt_idx" ON "C2Command"("engagementId", "createdAt");
