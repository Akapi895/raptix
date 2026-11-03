-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autoIngestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "triedEdgesEnabled" BOOLEAN NOT NULL DEFAULT false;
