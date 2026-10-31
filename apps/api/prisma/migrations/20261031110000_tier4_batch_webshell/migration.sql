-- CreateTable
CREATE TABLE "BatchQueue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "hitlPolicy" TEXT NOT NULL DEFAULT '',
    "scheduleMode" TEXT NOT NULL DEFAULT 'manual',
    "cronExpr" TEXT NOT NULL DEFAULT '',
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastScheduleTriggerAt" TIMESTAMP(3),
    "lastScheduleError" TEXT,
    "lastRunError" TEXT,
    "projectId" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "currentIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BatchQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchQueue_projectId_idx" ON "BatchQueue"("projectId");

-- AddForeignKey
ALTER TABLE "BatchQueue" ADD CONSTRAINT "BatchQueue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "BatchTask" (
    "id" TEXT NOT NULL,
    "queueId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "conversationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "result" TEXT,

    CONSTRAINT "BatchTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BatchTask_queueId_idx" ON "BatchTask"("queueId");

-- AddForeignKey
ALTER TABLE "BatchTask" ADD CONSTRAINT "BatchTask_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "BatchQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "WebShellConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "url" TEXT NOT NULL,
    "password" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT 'php',
    "method" TEXT NOT NULL DEFAULT 'post',
    "cmdParam" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "encoding" TEXT NOT NULL DEFAULT 'auto',
    "os" TEXT NOT NULL DEFAULT 'auto',
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebShellConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebShellConnection_projectId_idx" ON "WebShellConnection"("projectId");

-- AddForeignKey
ALTER TABLE "WebShellConnection" ADD CONSTRAINT "WebShellConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Conversation may be linked to the webshell connection it was opened from.
ALTER TABLE "Conversation" ADD COLUMN "webshellConnectionId" TEXT;

-- CreateIndex
CREATE INDEX "Conversation_webshellConnectionId_idx" ON "Conversation"("webshellConnectionId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_webshellConnectionId_fkey" FOREIGN KEY ("webshellConnectionId") REFERENCES "WebShellConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
