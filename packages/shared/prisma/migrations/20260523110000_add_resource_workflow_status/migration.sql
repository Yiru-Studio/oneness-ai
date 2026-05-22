-- CreateEnum
CREATE TYPE "ResourceReviewStatus" AS ENUM ('NEEDS_REVIEW', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ResourcePromptStatus" AS ENUM ('EMPTY', 'QUEUED', 'RUNNING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Character"
  ADD COLUMN "reviewStatus" "ResourceReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW';

-- AlterTable
ALTER TABLE "CharacterStyle"
  ADD COLUMN "promptStatus" "ResourcePromptStatus" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "promptTaskId" TEXT,
  ADD COLUMN "promptError" TEXT;

-- AlterTable
ALTER TABLE "Scene"
  ADD COLUMN "reviewStatus" "ResourceReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN "promptStatus" "ResourcePromptStatus" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "promptTaskId" TEXT,
  ADD COLUMN "promptError" TEXT;

-- AlterTable
ALTER TABLE "Item"
  ADD COLUMN "reviewStatus" "ResourceReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  ADD COLUMN "promptStatus" "ResourcePromptStatus" NOT NULL DEFAULT 'EMPTY',
  ADD COLUMN "promptTaskId" TEXT,
  ADD COLUMN "promptError" TEXT;

-- Backfill review status: resources that already have a prompt or current image
-- are considered ready to continue the production flow. Plain extracted names
-- and descriptions remain in NEEDS_REVIEW.
UPDATE "Character" c
SET "reviewStatus" = 'CONFIRMED'
WHERE c."avatarAssetId" IS NOT NULL
   OR EXISTS (
     SELECT 1
     FROM "CharacterStyle" cs
     WHERE cs."characterId" = c."id"
       AND (cs."assetId" IS NOT NULL OR length(trim(coalesce(cs."prompt", ''))) > 0)
   );

UPDATE "Scene"
SET
  "reviewStatus" = CASE
    WHEN "assetId" IS NOT NULL OR length(trim(coalesce("prompt", ''))) > 0
      THEN 'CONFIRMED'::"ResourceReviewStatus"
    ELSE 'NEEDS_REVIEW'::"ResourceReviewStatus"
  END,
  "promptStatus" = CASE
    WHEN length(trim(coalesce("prompt", ''))) > 0
      THEN 'READY'::"ResourcePromptStatus"
    ELSE 'EMPTY'::"ResourcePromptStatus"
  END;

UPDATE "Item"
SET
  "reviewStatus" = CASE
    WHEN "assetId" IS NOT NULL OR length(trim(coalesce("prompt", ''))) > 0
      THEN 'CONFIRMED'::"ResourceReviewStatus"
    ELSE 'NEEDS_REVIEW'::"ResourceReviewStatus"
  END,
  "promptStatus" = CASE
    WHEN length(trim(coalesce("prompt", ''))) > 0
      THEN 'READY'::"ResourcePromptStatus"
    ELSE 'EMPTY'::"ResourcePromptStatus"
  END;

UPDATE "CharacterStyle"
SET "promptStatus" = CASE
  WHEN length(trim(coalesce("prompt", ''))) > 0
    THEN 'READY'::"ResourcePromptStatus"
  ELSE 'EMPTY'::"ResourcePromptStatus"
END;

-- CreateIndex
CREATE INDEX "CharacterStyle_promptStatus_idx" ON "CharacterStyle"("promptStatus");

-- CreateIndex
CREATE INDEX "CharacterStyle_promptTaskId_idx" ON "CharacterStyle"("promptTaskId");

-- CreateIndex
CREATE INDEX "Item_reviewStatus_idx" ON "Item"("reviewStatus");

-- CreateIndex
CREATE INDEX "Item_promptStatus_idx" ON "Item"("promptStatus");

-- CreateIndex
CREATE INDEX "Item_promptTaskId_idx" ON "Item"("promptTaskId");

-- CreateIndex
CREATE INDEX "Scene_reviewStatus_idx" ON "Scene"("reviewStatus");

-- CreateIndex
CREATE INDEX "Scene_promptStatus_idx" ON "Scene"("promptStatus");

-- CreateIndex
CREATE INDEX "Scene_promptTaskId_idx" ON "Scene"("promptTaskId");
