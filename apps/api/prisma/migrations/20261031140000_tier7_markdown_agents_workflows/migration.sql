-- CreateTable
CREATE TABLE "MarkdownAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isOrchestrator" BOOLEAN NOT NULL DEFAULT false,
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "instruction" TEXT NOT NULL DEFAULT '',
    "bindRole" TEXT NOT NULL DEFAULT '',
    "maxIterations" INTEGER NOT NULL DEFAULT 0,
    "kind" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarkdownAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "graphJson" TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[],"config":{}}',
    "validationError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);
