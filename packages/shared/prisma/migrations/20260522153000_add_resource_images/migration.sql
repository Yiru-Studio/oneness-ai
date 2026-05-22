-- CreateTable
CREATE TABLE "ResourceImage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "status" "TaskStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "prompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "ratio" TEXT,
    "error" TEXT,
    "assetId" TEXT,
    "taskId" TEXT,
    "characterStyleId" TEXT,
    "sceneId" TEXT,
    "itemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ResourceImage_one_entity_check" CHECK (
      (
        CASE WHEN "characterStyleId" IS NULL THEN 0 ELSE 1 END +
        CASE WHEN "sceneId" IS NULL THEN 0 ELSE 1 END +
        CASE WHEN "itemId" IS NULL THEN 0 ELSE 1 END
      ) = 1
    ),
    CONSTRAINT "ResourceImage_kind_entity_check" CHECK (
      ("kind" = 'character-style' AND "characterStyleId" IS NOT NULL AND "sceneId" IS NULL AND "itemId" IS NULL) OR
      ("kind" = 'scene' AND "sceneId" IS NOT NULL AND "characterStyleId" IS NULL AND "itemId" IS NULL) OR
      ("kind" = 'item' AND "itemId" IS NOT NULL AND "characterStyleId" IS NULL AND "sceneId" IS NULL)
    ),
    CONSTRAINT "ResourceImage_source_check" CHECK ("source" IN ('generated', 'upload', 'legacy'))
);

-- CreateIndex
CREATE INDEX "ResourceImage_ownerId_projectId_createdAt_idx" ON "ResourceImage"("ownerId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceImage_characterStyleId_createdAt_idx" ON "ResourceImage"("characterStyleId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceImage_sceneId_createdAt_idx" ON "ResourceImage"("sceneId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceImage_itemId_createdAt_idx" ON "ResourceImage"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "ResourceImage_taskId_idx" ON "ResourceImage"("taskId");

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_characterStyleId_fkey" FOREIGN KEY ("characterStyleId") REFERENCES "CharacterStyle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceImage" ADD CONSTRAINT "ResourceImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing current images into legacy history.
INSERT INTO "ResourceImage" (
  "id",
  "ownerId",
  "projectId",
  "kind",
  "source",
  "status",
  "prompt",
  "model",
  "ratio",
  "assetId",
  "characterStyleId",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('character-style:' || cs."id"),
  p."ownerId",
  c."projectId",
  'character-style',
  'legacy',
  'SUCCEEDED',
  COALESCE(cs."prompt", ''),
  cs."model",
  cs."ratio",
  cs."assetId",
  cs."id",
  cs."updatedAt",
  CURRENT_TIMESTAMP
FROM "CharacterStyle" cs
JOIN "Character" c ON c."id" = cs."characterId"
JOIN "Project" p ON p."id" = c."projectId"
WHERE cs."assetId" IS NOT NULL;

INSERT INTO "ResourceImage" (
  "id",
  "ownerId",
  "projectId",
  "kind",
  "source",
  "status",
  "prompt",
  "model",
  "ratio",
  "assetId",
  "sceneId",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('scene:' || s."id"),
  p."ownerId",
  s."projectId",
  'scene',
  'legacy',
  'SUCCEEDED',
  COALESCE(s."prompt", ''),
  s."model",
  s."ratio",
  s."assetId",
  s."id",
  s."updatedAt",
  CURRENT_TIMESTAMP
FROM "Scene" s
JOIN "Project" p ON p."id" = s."projectId"
WHERE s."assetId" IS NOT NULL;

INSERT INTO "ResourceImage" (
  "id",
  "ownerId",
  "projectId",
  "kind",
  "source",
  "status",
  "prompt",
  "model",
  "ratio",
  "assetId",
  "itemId",
  "createdAt",
  "updatedAt"
)
SELECT
  md5('item:' || i."id"),
  p."ownerId",
  i."projectId",
  'item',
  'legacy',
  'SUCCEEDED',
  COALESCE(i."prompt", ''),
  i."model",
  i."ratio",
  i."assetId",
  i."id",
  i."updatedAt",
  CURRENT_TIMESTAMP
FROM "Item" i
JOIN "Project" p ON p."id" = i."projectId"
WHERE i."assetId" IS NOT NULL;
