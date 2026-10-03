ALTER TABLE "CampaignJob" ADD COLUMN "requestId" TEXT;
ALTER TABLE "CampaignJob" ADD COLUMN "payloadHash" TEXT;
CREATE UNIQUE INDEX "CampaignJob_campaignId_requestId_key" ON "CampaignJob"("campaignId", "requestId");
