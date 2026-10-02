-- Additive: optional operator-facing display label.
ALTER TABLE "Engagement" ADD COLUMN "displayName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Engagement_userId_name_key" ON "Engagement"("userId", "name");
