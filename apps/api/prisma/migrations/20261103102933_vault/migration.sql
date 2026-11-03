-- CreateEnum
CREATE TYPE "VaultSecretScope" AS ENUM ('PROJECT', 'GLOBAL');

-- CreateTable
CREATE TABLE "VaultSecret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scope" "VaultSecretScope" NOT NULL DEFAULT 'PROJECT',
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'credential',
    "cipherText" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceProjectId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "VaultSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultAudit" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "projectId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultSecret_projectId_idx" ON "VaultSecret"("projectId");

-- CreateIndex
CREATE INDEX "VaultSecret_scope_idx" ON "VaultSecret"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSecret_projectId_name_key" ON "VaultSecret"("projectId", "name");

-- CreateIndex
CREATE INDEX "VaultAudit_secretId_idx" ON "VaultAudit"("secretId");

-- CreateIndex
CREATE INDEX "VaultAudit_createdAt_idx" ON "VaultAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
