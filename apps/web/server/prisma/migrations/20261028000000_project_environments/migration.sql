-- ADR-0092 project environments. Additive only: no existing table, column or
-- constraint is altered. Existing deployments have no DeploymentSlot row,
-- which the service treats as idle.

-- CreateEnum
CREATE TYPE "DeploymentSlotPhase" AS ENUM ('idle', 'starting', 'ready', 'stopping', 'uncertain');

-- CreateEnum
CREATE TYPE "EnvironmentDesiredState" AS ENUM ('stopped', 'ready');

-- CreateEnum
CREATE TYPE "EnvironmentObservedState" AS ENUM ('unprovisioned', 'starting', 'ready', 'stopping', 'stopped', 'uncertain');

-- CreateEnum
CREATE TYPE "EnvironmentCommandAction" AS ENUM ('activate', 'stop');

-- CreateEnum
CREATE TYPE "EnvironmentCommandOutcome" AS ENUM ('accepted', 'observed', 'refused', 'uncertain');

-- CreateTable
CREATE TABLE "DeploymentSlot" (
    "deploymentId" TEXT NOT NULL,
    "phase" "DeploymentSlotPhase" NOT NULL DEFAULT 'idle',
    "ownerEngagementId" TEXT,
    "commandId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentSlot_pkey" PRIMARY KEY ("deploymentId")
);

-- CreateTable
CREATE TABLE "ProjectEnvironment" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "desiredState" "EnvironmentDesiredState" NOT NULL DEFAULT 'stopped',
    "observedState" "EnvironmentObservedState" NOT NULL DEFAULT 'unprovisioned',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "observedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectEnvironment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnvironmentCommand" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "EnvironmentCommandAction" NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "payloadFingerprint" TEXT NOT NULL,
    "outcome" "EnvironmentCommandOutcome" NOT NULL DEFAULT 'accepted',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EnvironmentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEnvironment_deploymentId_engagementId_key" ON "ProjectEnvironment"("deploymentId", "engagementId");

-- CreateIndex
CREATE INDEX "EnvironmentCommand_deploymentId_outcome_idx" ON "EnvironmentCommand"("deploymentId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "EnvironmentCommand_deploymentId_requestId_key" ON "EnvironmentCommand"("deploymentId", "requestId");

-- AddForeignKey
ALTER TABLE "DeploymentSlot" ADD CONSTRAINT "DeploymentSlot_ownerEngagementId_fkey" FOREIGN KEY ("ownerEngagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEnvironment" ADD CONSTRAINT "ProjectEnvironment_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvironmentCommand" ADD CONSTRAINT "EnvironmentCommand_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
