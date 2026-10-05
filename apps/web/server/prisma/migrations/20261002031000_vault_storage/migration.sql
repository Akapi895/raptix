-- W18: server-side encrypted vault. Ciphertext columns are opaque to the DB;
-- the audit log is engagement-scoped and survives secret deletion.

-- CreateTable
CREATE TABLE "VaultSecret" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAudit" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultSecret_engagementId_kind_idx" ON "VaultSecret"("engagementId", "kind");

-- CreateIndex
CREATE INDEX "VaultAudit_engagementId_createdAt_idx" ON "VaultAudit"("engagementId", "createdAt");

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
