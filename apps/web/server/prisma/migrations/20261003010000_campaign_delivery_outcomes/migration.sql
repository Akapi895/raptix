ALTER TABLE "CampaignJob" ADD COLUMN "activeCampaignId" TEXT;
ALTER TABLE "CampaignJob" ADD COLUMN "providerId" TEXT;
ALTER TABLE "CampaignJob" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "CampaignJob" ADD COLUMN "summary" JSONB;
ALTER TABLE "CampaignJob" ADD COLUMN "campaignVersion" INTEGER;
CREATE UNIQUE INDEX "CampaignJob_activeCampaignId_key" ON "CampaignJob"("activeCampaignId");
