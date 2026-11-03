-- Project facts + fact edges (apps/ui-app's facts tab / fact-graph contract,
-- internal/database/project.go's ProjectFact/ProjectFactEdge). Edges are
-- foreign-keyed to fact rows -- an edge cannot dangle when its endpoint fact
-- is renamed (the key is derived, not stored) and cascades away with it.

-- CreateTable
CREATE TABLE "ProjectFact" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'note',
    "summary" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "relatedVulnerabilityId" TEXT NOT NULL DEFAULT '',
    "sourceConversationId" TEXT NOT NULL DEFAULT '',
    "sourceMessageId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFactEdge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL DEFAULT 'related',
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceFactId" TEXT NOT NULL,
    "targetFactId" TEXT NOT NULL,

    CONSTRAINT "ProjectFactEdge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFact_projectId_factKey_key" ON "ProjectFact"("projectId", "factKey");

-- CreateIndex
CREATE INDEX "ProjectFact_projectId_deprecated_idx" ON "ProjectFact"("projectId", "deprecated");

-- CreateIndex
CREATE INDEX "ProjectFactEdge_projectId_idx" ON "ProjectFactEdge"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFactEdge_sourceFactId_idx" ON "ProjectFactEdge"("sourceFactId");

-- CreateIndex
CREATE INDEX "ProjectFactEdge_targetFactId_idx" ON "ProjectFactEdge"("targetFactId");

-- AddForeignKey
ALTER TABLE "ProjectFact" ADD CONSTRAINT "ProjectFact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFactEdge" ADD CONSTRAINT "ProjectFactEdge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFactEdge" ADD CONSTRAINT "ProjectFactEdge_sourceFactId_fkey" FOREIGN KEY ("sourceFactId") REFERENCES "ProjectFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFactEdge" ADD CONSTRAINT "ProjectFactEdge_targetFactId_fkey" FOREIGN KEY ("targetFactId") REFERENCES "ProjectFact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
