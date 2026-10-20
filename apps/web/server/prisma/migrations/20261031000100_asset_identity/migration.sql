-- ADR-0094: asset identity catalog keyed by the deterministic assetId. Additive only; WebAsset is unchanged.

-- CreateTable
CREATE TABLE "AssetIdentity" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "canonicalKey" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssetIdentity_engagementId_kind_namespace_canonicalKey_key" ON "AssetIdentity"("engagementId", "kind", "namespace", "canonicalKey");

-- CreateIndex
CREATE INDEX "AssetIdentity_engagementId_kind_idx" ON "AssetIdentity"("engagementId", "kind");
