-- ADR-0087: retained bytes have an opaque identity and a durable classification.
CREATE TABLE "RetainedCapture" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "producer" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "classification" TEXT NOT NULL DEFAULT 'unclassified',
    "classificationVersion" INTEGER NOT NULL DEFAULT 1,
    "classifiedBy" TEXT,
    "classificationReason" TEXT,
    "classifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetainedCapture_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvidenceLink" ADD COLUMN "captureId" TEXT;

CREATE UNIQUE INDEX "RetainedCapture_engagementId_requestId_key" ON "RetainedCapture"("engagementId", "requestId");
CREATE UNIQUE INDEX "RetainedCapture_engagementId_path_key" ON "RetainedCapture"("engagementId", "path");
CREATE INDEX "RetainedCapture_engagementId_classification_createdAt_idx" ON "RetainedCapture"("engagementId", "classification", "createdAt");
CREATE UNIQUE INDEX "EvidenceLink_findingId_captureId_key" ON "EvidenceLink"("findingId", "captureId");

ALTER TABLE "RetainedCapture" ADD CONSTRAINT "RetainedCapture_engagementId_fkey"
  FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_captureId_fkey"
  FOREIGN KEY ("captureId") REFERENCES "RetainedCapture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
