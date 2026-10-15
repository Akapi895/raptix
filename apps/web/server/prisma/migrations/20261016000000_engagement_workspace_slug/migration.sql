-- W01: server-issued, globally unique workspace partition identity.
-- Backfill policy: inside a name-collision group the row that already owns a
-- runtime binding (threadId/runtimeContextLockedAt), else the oldest row,
-- keeps `name` as its slug so existing workspace dirs and thread context
-- hashes stay valid; every other colliding row derives
-- `left(name, 57) || '-' || md5(id)[1:6]`. Filesystem data is never moved or
-- merged here — a renamed row simply starts a fresh partition; any residue
-- already shared inside the old directory needs an operator mapping decision
-- (docs/design/2026-10-15-web-completion-implementation-plan.md, W01).
ALTER TABLE "Engagement" ADD COLUMN "workspaceSlug" TEXT;

UPDATE "Engagement" e
SET "workspaceSlug" = e.name
WHERE NOT EXISTS (
  SELECT 1
  FROM "Engagement" o
  WHERE o.name = e.name
    AND (
      (COALESCE(o."threadId", '') <> '' OR o."runtimeContextLockedAt" IS NOT NULL)
        > (COALESCE(e."threadId", '') <> '' OR e."runtimeContextLockedAt" IS NOT NULL)
      OR (
        (COALESCE(o."threadId", '') <> '' OR o."runtimeContextLockedAt" IS NOT NULL)
          = (COALESCE(e."threadId", '') <> '' OR e."runtimeContextLockedAt" IS NOT NULL)
        AND (o."createdAt", o."id") < (e."createdAt", e."id")
      )
    )
);

UPDATE "Engagement" e
SET "workspaceSlug" = left(e.name, 57) || '-' || substr(md5(e."id"), 1, 6)
WHERE "workspaceSlug" IS NULL;

ALTER TABLE "Engagement" ALTER COLUMN "workspaceSlug" SET NOT NULL;
CREATE UNIQUE INDEX "Engagement_workspaceSlug_key" ON "Engagement"("workspaceSlug");
