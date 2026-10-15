-- ADR-0070: engagement-scoped library review proposals referencing the
-- canonical corpus without creating a second executable corpus.
CREATE TABLE "LibraryReviewProposal" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "skillName" TEXT NOT NULL,
    "skillPath" TEXT NOT NULL,
    "baseRevision" TEXT NOT NULL,
    "baseBody" TEXT NOT NULL,
    "proposedBody" TEXT NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryReviewProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LibraryProposalReview" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL,
    "decision" TEXT NOT NULL,
    "comment" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryProposalReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LibraryReviewProposal_engagementId_status_idx" ON "LibraryReviewProposal"("engagementId", "status");
CREATE UNIQUE INDEX "LibraryReviewProposal_engagementId_skillName_version_key" ON "LibraryReviewProposal"("engagementId", "skillName", "version");
CREATE INDEX "LibraryProposalReview_proposalId_idx" ON "LibraryProposalReview"("proposalId");

ALTER TABLE "LibraryProposalReview" ADD CONSTRAINT "LibraryProposalReview_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "LibraryReviewProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
