-- W17: proposal versions are proposal-local (the proposal id is the
-- identity). The engagement-wide unique (engagementId, skillName, version)
-- wrongly collided concurrent proposals for the same skill. One in-review
-- proposal per (engagementId, skillName) is enforced instead.
DROP INDEX IF EXISTS "LibraryReviewProposal_engagementId_skillName_version_key";

CREATE UNIQUE INDEX "LibraryReviewProposal_one_in_review_per_skill_idx"
  ON "LibraryReviewProposal"("engagementId", "skillName")
  WHERE status = 'proposed';
