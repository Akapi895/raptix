-- Briefing-first engagements: operator brief captured at creation, plus the
-- explicit planning-handoff confirmation instant gating execution chats.
ALTER TABLE "Engagement" ADD COLUMN "brief" TEXT;
ALTER TABLE "Engagement" ADD COLUMN "handoffConfirmedAt" TIMESTAMP(3);
