-- ADR-0092 I07: records the verified message count an operator imported for one migrated thread. Additive only.

-- CreateTable
CREATE TABLE "ThreadMigrationRecord" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "verifiedMessageCount" INTEGER NOT NULL,
    "sourceSlug" TEXT NOT NULL,
    "importedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThreadMigrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ThreadMigrationRecord_engagementId_threadId_key" ON "ThreadMigrationRecord"("engagementId", "threadId");

-- AddForeignKey
ALTER TABLE "ThreadMigrationRecord" ADD CONSTRAINT "ThreadMigrationRecord_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
