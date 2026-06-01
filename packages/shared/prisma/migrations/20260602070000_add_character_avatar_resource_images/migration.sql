-- Add character-avatar as a first-class resource image target.
ALTER TABLE "ResourceImage" ADD COLUMN "characterId" TEXT;

ALTER TABLE "ResourceImage" DROP CONSTRAINT IF EXISTS "ResourceImage_one_entity_check";
ALTER TABLE "ResourceImage" DROP CONSTRAINT IF EXISTS "ResourceImage_kind_entity_check";

ALTER TABLE "ResourceImage"
  ADD CONSTRAINT "ResourceImage_one_entity_check" CHECK (
    (
      CASE WHEN "characterId" IS NULL THEN 0 ELSE 1 END +
      CASE WHEN "characterStyleId" IS NULL THEN 0 ELSE 1 END +
      CASE WHEN "sceneId" IS NULL THEN 0 ELSE 1 END +
      CASE WHEN "itemId" IS NULL THEN 0 ELSE 1 END
    ) = 1
  );

ALTER TABLE "ResourceImage"
  ADD CONSTRAINT "ResourceImage_kind_entity_check" CHECK (
    ("kind" = 'character-avatar' AND "characterId" IS NOT NULL AND "characterStyleId" IS NULL AND "sceneId" IS NULL AND "itemId" IS NULL) OR
    ("kind" = 'character-style' AND "characterStyleId" IS NOT NULL AND "characterId" IS NULL AND "sceneId" IS NULL AND "itemId" IS NULL) OR
    ("kind" = 'scene' AND "sceneId" IS NOT NULL AND "characterId" IS NULL AND "characterStyleId" IS NULL AND "itemId" IS NULL) OR
    ("kind" = 'item' AND "itemId" IS NOT NULL AND "characterId" IS NULL AND "characterStyleId" IS NULL AND "sceneId" IS NULL)
  );

CREATE INDEX "ResourceImage_characterId_createdAt_idx" ON "ResourceImage"("characterId", "createdAt");

ALTER TABLE "ResourceImage"
  ADD CONSTRAINT "ResourceImage_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing role avatars into legacy avatar history.
INSERT INTO "ResourceImage" (
  "id",
  "ownerId",
  "projectId",
  "kind",
  "source",
  "status",
  "prompt",
  "assetId",
  "characterId",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('character-avatar:' || c."id"),
  p."ownerId",
  c."projectId",
  'character-avatar',
  'legacy',
  'SUCCEEDED',
  COALESCE(c."avatarPrompt", ''),
  c."avatarAssetId",
  c."id",
  c."updatedAt",
  CURRENT_TIMESTAMP
FROM "Character" c
JOIN "Project" p ON p."id" = c."projectId"
WHERE c."avatarAssetId" IS NOT NULL;
