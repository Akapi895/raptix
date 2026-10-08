ALTER TABLE "WebRequestLedger"
  ADD COLUMN "candidateThreadId" TEXT,
  ADD COLUMN "dispatchAssistantId" TEXT,
  ADD COLUMN "dispatchKind" "ThreadKind",
  ADD COLUMN "dispatchConfigHash" TEXT;
CREATE UNIQUE INDEX "WebRequestLedger_candidateThreadId_key" ON "WebRequestLedger"("candidateThreadId");
