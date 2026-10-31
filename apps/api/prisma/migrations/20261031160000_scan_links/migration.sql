-- Scan links: which scan conversation or batch task touched which asset
-- (apps/ui-app's assets feature ScanLink payload). Write-only from the
-- frontend; cascades away with its asset.

-- CreateTable
CREATE TABLE "ScanLink" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL DEFAULT '',
    "queueId" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScanLink_assetId_idx" ON "ScanLink"("assetId");

-- CreateIndex
CREATE INDEX "ScanLink_conversationId_idx" ON "ScanLink"("conversationId");

-- CreateIndex
CREATE INDEX "ScanLink_queueId_idx" ON "ScanLink"("queueId");

-- AddForeignKey
ALTER TABLE "ScanLink" ADD CONSTRAINT "ScanLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
