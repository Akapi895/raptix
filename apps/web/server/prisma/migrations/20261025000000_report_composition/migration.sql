-- P06/P07: report composition (template, period, named reviewer, lineage and
-- finding snapshots) and separate recipient acknowledgement. Additive only:
-- existing report and delivery rows keep NULL for every new column.
ALTER TABLE "ReportRecord" ADD COLUMN "templateId" TEXT, ADD COLUMN "templateVersion" INTEGER,
  ADD COLUMN "periodStart" TIMESTAMP(3), ADD COLUMN "periodEnd" TIMESTAMP(3),
  ADD COLUMN "reviewerId" TEXT, ADD COLUMN "parentReportId" TEXT, ADD COLUMN "rootReportId" TEXT;
CREATE INDEX "ReportRecord_engagementId_rootReportId_idx" ON "ReportRecord"("engagementId", "rootReportId");

CREATE TABLE "ReportTemplate" (
  "id" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "sections" JSONB NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportTemplate_engagementId_name_version_key" ON "ReportTemplate"("engagementId", "name", "version");
CREATE INDEX "ReportTemplate_engagementId_createdAt_idx" ON "ReportTemplate"("engagementId", "createdAt");

CREATE TABLE "ReportFindingSnapshot" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "findingVersion" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "body" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "position" INTEGER NOT NULL,
  "selectedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportFindingSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportFindingSnapshot_reportId_findingId_key" ON "ReportFindingSnapshot"("reportId", "findingId");
CREATE INDEX "ReportFindingSnapshot_reportId_position_idx" ON "ReportFindingSnapshot"("reportId", "position");
ALTER TABLE "ReportFindingSnapshot" ADD CONSTRAINT "ReportFindingSnapshot_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReportRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ReportAcknowledgement" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "engagementId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "receipt" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportAcknowledgement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReportAcknowledgement_deliveryId_key" ON "ReportAcknowledgement"("deliveryId");
CREATE UNIQUE INDEX "ReportAcknowledgement_deliveryId_requestId_key" ON "ReportAcknowledgement"("deliveryId", "requestId");
CREATE INDEX "ReportAcknowledgement_engagementId_createdAt_idx" ON "ReportAcknowledgement"("engagementId", "createdAt");
ALTER TABLE "ReportAcknowledgement" ADD CONSTRAINT "ReportAcknowledgement_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "ReportDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
