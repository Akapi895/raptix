-- ADR-0105: WebShell is a request/response provider with its own records.
-- The Web server owns these rows; the runtime executes through the project
-- sandbox and returns bounded probe/command results.

CREATE TABLE "WebShellConnection" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "assetId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'http-form-command',
    "name" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'POST',
    "contentType" TEXT NOT NULL DEFAULT 'application/x-www-form-urlencoded',
    "commandParameter" TEXT NOT NULL,
    "headers" JSONB,
    "probeCommand" TEXT NOT NULL,
    "probePattern" TEXT NOT NULL,
    "expectedUser" TEXT,
    "state" TEXT NOT NULL DEFAULT 'unverified',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdBy" TEXT NOT NULL,
    "producerFindingId" TEXT,
    "producerPocSha256" TEXT,
    "producerSpecSha256" TEXT,
    "producerAcquisitionId" TEXT,
    "lastProbeId" TEXT,
    "lastProbeAt" TIMESTAMP(3),
    "concurrencyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebShellConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebShellProbe" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "output" TEXT NOT NULL DEFAULT '',
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebShellProbe_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebShellCommand" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "httpStatus" INTEGER,
    "exitCode" INTEGER,
    "output" TEXT NOT NULL DEFAULT '',
    "outputTruncated" BOOLEAN NOT NULL DEFAULT false,
    "capturePath" TEXT,
    "captureSha256" TEXT,
    "error" TEXT,
    "actorId" TEXT NOT NULL,
    "runId" TEXT,
    "invocationId" TEXT,
    "activeConnectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebShellCommand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebShellAcquisition" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "pocSha256" TEXT,
    "specSha256" TEXT,
    "profile" JSONB,
    "connectionId" TEXT,
    "error" TEXT,
    "artifactPath" TEXT,
    "artifactSha256" TEXT,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebShellAcquisition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebShellConnection_endpoint_key" ON "WebShellConnection"("engagementId", "provider", "endpoint", "commandParameter");
CREATE INDEX "WebShellConnection_engagementId_state_idx" ON "WebShellConnection"("engagementId", "state");

CREATE UNIQUE INDEX "WebShellProbe_request_key" ON "WebShellProbe"("connectionId", "requestId");
CREATE INDEX "WebShellProbe_connectionId_createdAt_idx" ON "WebShellProbe"("connectionId", "createdAt");

CREATE UNIQUE INDEX "WebShellCommand_activeConnectionId_key" ON "WebShellCommand"("activeConnectionId");
CREATE UNIQUE INDEX "WebShellCommand_request_key" ON "WebShellCommand"("engagementId", "requestId");
CREATE INDEX "WebShellCommand_connectionId_createdAt_idx" ON "WebShellCommand"("connectionId", "createdAt");

CREATE UNIQUE INDEX "WebShellAcquisition_request_key" ON "WebShellAcquisition"("engagementId", "requestId");
CREATE INDEX "WebShellAcquisition_engagementId_findingId_createdAt_idx" ON "WebShellAcquisition"("engagementId", "findingId", "createdAt");

ALTER TABLE "WebShellConnection" ADD CONSTRAINT "WebShellConnection_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebShellProbe" ADD CONSTRAINT "WebShellProbe_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WebShellConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebShellProbe" ADD CONSTRAINT "WebShellProbe_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebShellCommand" ADD CONSTRAINT "WebShellCommand_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WebShellConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebShellCommand" ADD CONSTRAINT "WebShellCommand_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WebShellAcquisition" ADD CONSTRAINT "WebShellAcquisition_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "WebShellConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WebShellAcquisition" ADD CONSTRAINT "WebShellAcquisition_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
