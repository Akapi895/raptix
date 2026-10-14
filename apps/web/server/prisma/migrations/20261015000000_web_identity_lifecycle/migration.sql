-- Web workflow lifecycle storage (ADR-0069). Plain FK columns, no Prisma
-- relation fields: lifecycle rows reference engagements without copying
-- runtime-owned state. Ids are client-generated cuids; timestamps are
-- client-supplied, so no database defaults are required.

CREATE TABLE "WebUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebUser_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebUser_username_key" ON "WebUser"("username");

CREATE TABLE "WebSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebSession_userId_idx" ON "WebSession"("userId");

CREATE TABLE "WebMembership" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebMembership_engagementId_userId_key" ON "WebMembership"("engagementId", "userId");
CREATE INDEX "WebMembership_userId_idx" ON "WebMembership"("userId");
ALTER TABLE "WebMembership" ADD CONSTRAINT "WebMembership_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebAuditEntry" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "reason" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebAuditEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebAuditEntry_engagementId_createdAt_idx" ON "WebAuditEntry"("engagementId", "createdAt");
CREATE INDEX "WebAuditEntry_actorId_createdAt_idx" ON "WebAuditEntry"("actorId", "createdAt");

CREATE TABLE "ScopeRevision" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "diff" JSONB NOT NULL,
    "roe" JSONB NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ScopeRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScopeRevision_engagementId_version_key" ON "ScopeRevision"("engagementId", "version");
CREATE INDEX "ScopeRevision_engagementId_status_idx" ON "ScopeRevision"("engagementId", "status");
ALTER TABLE "ScopeRevision" ADD CONSTRAINT "ScopeRevision_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebAsset" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'host',
    "classification" TEXT NOT NULL DEFAULT 'pending',
    "observed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebAsset_engagementId_identifier_key" ON "WebAsset"("engagementId", "identifier");
CREATE INDEX "WebAsset_engagementId_classification_idx" ON "WebAsset"("engagementId", "classification");
ALTER TABLE "WebAsset" ADD CONSTRAINT "WebAsset_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "BusinessPlan" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" JSONB NOT NULL,
    "roeVersion" INTEGER,
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionComment" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BusinessPlan_engagementId_version_key" ON "BusinessPlan"("engagementId", "version");
CREATE INDEX "BusinessPlan_engagementId_status_idx" ON "BusinessPlan"("engagementId", "status");
ALTER TABLE "BusinessPlan" ADD CONSTRAINT "BusinessPlan_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OperationBinding" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "threadId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'bound',
    "concurrencyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OperationBinding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperationBinding_engagementId_status_idx" ON "OperationBinding"("engagementId", "status");
ALTER TABLE "OperationBinding" ADD CONSTRAINT "OperationBinding_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationBinding" ADD CONSTRAINT "OperationBinding_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BusinessPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EmergencyStop" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmergencyStop_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmergencyStop_engagementId_createdAt_idx" ON "EmergencyStop"("engagementId", "createdAt");
ALTER TABLE "EmergencyStop" ADD CONSTRAINT "EmergencyStop_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FindingRecord" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" JSONB NOT NULL,
    "expectedVersion" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT NOT NULL DEFAULT 'authored',
    "producerRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FindingRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FindingRecord_engagementId_status_idx" ON "FindingRecord"("engagementId", "status");
ALTER TABLE "FindingRecord" ADD CONSTRAINT "FindingRecord_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "artifactPath" TEXT,
    "digest" TEXT,
    "producer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EvidenceLink_findingId_idx" ON "EvidenceLink"("findingId");
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "FindingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportRecord" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "body" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewComment" TEXT,
    "approvedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReportRecord_engagementId_status_idx" ON "ReportRecord"("engagementId", "status");
ALTER TABLE "ReportRecord" ADD CONSTRAINT "ReportRecord_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportDelivery" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportDelivery_reportId_requestId_key" ON "ReportDelivery"("reportId", "requestId");
CREATE INDEX "ReportDelivery_engagementId_createdAt_idx" ON "ReportDelivery"("engagementId", "createdAt");
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "C2Grant" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "reason" TEXT NOT NULL,
    "commandPrefix" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "C2Grant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "C2Grant_engagementId_sessionId_status_idx" ON "C2Grant"("engagementId", "sessionId", "status");
ALTER TABLE "C2Grant" ADD CONSTRAINT "C2Grant_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebNotice" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebNotice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WebNotice_actorId_createdAt_idx" ON "WebNotice"("actorId", "createdAt");

CREATE TABLE "WorkspaceSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkspaceSetting_key_key" ON "WorkspaceSetting"("key");

CREATE TABLE "EngagementClosure" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requestedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EngagementClosure_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EngagementClosure_engagementId_key" ON "EngagementClosure"("engagementId");
ALTER TABLE "EngagementClosure" ADD CONSTRAINT "EngagementClosure_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
