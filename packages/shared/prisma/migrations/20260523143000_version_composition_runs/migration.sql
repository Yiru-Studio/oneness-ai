-- Version composition image/grid generation so retries keep historical outputs.

-- CreateTable
CREATE TABLE "CompositionImageRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "negativePrompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "quality" TEXT NOT NULL DEFAULT 'standard',
    "outputCount" INTEGER NOT NULL DEFAULT 1,
    "seed" TEXT,
    "characterConsistency" INTEGER NOT NULL DEFAULT 50,
    "sceneConsistency" INTEGER NOT NULL DEFAULT 50,
    "itemConsistency" INTEGER NOT NULL DEFAULT 50,
    "params" JSONB NOT NULL DEFAULT '{}',
    "referenceAssetIds" JSONB NOT NULL DEFAULT '[]',
    "characterStyleIds" JSONB NOT NULL DEFAULT '[]',
    "sceneIds" JSONB NOT NULL DEFAULT '[]',
    "itemIds" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "taskJobId" TEXT,
    "outputAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionImageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionGridRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "imageRunId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "specification" TEXT NOT NULL DEFAULT '3x3',
    "variationMode" TEXT NOT NULL DEFAULT 'auto_angles',
    "consistency" INTEGER NOT NULL DEFAULT 80,
    "inheritStyle" BOOLEAN NOT NULL DEFAULT true,
    "inheritSeed" BOOLEAN NOT NULL DEFAULT false,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'READY',
    "error" TEXT,
    "costCredits" INTEGER NOT NULL DEFAULT 0,
    "gridAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionGridRun_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "CompositionTask"
ADD COLUMN "currentImageRunId" TEXT,
ADD COLUMN "currentGridRunId" TEXT;

-- AlterTable
ALTER TABLE "CompositionCandidate"
ADD COLUMN "gridRunId" TEXT,
ADD COLUMN "angleLabel" TEXT,
ADD COLUMN "appliedMode" TEXT,
ADD COLUMN "appliedAt" TIMESTAMP(3);

-- Preserve any phase-1 outputs as the initial historical version.
INSERT INTO "CompositionImageRun" (
  "id",
  "taskId",
  "prompt",
  "model",
  "ratio",
  "referenceAssetIds",
  "characterStyleIds",
  "sceneIds",
  "itemIds",
  "status",
  "error",
  "taskJobId",
  "outputAssetId",
  "createdAt",
  "updatedAt"
)
SELECT
  ct."id",
  ct."id",
  ct."prompt",
  p."imageModel",
  p."ratio",
  '[]'::jsonb,
  ct."characterStyleIds",
  ct."sceneIds",
  ct."itemIds",
  CASE
    WHEN ct."imageAssetId" IS NOT NULL THEN 'SUCCEEDED'
    WHEN ct."status" = 'IMAGE_FAILED' THEN 'FAILED'
    WHEN ct."status" = 'IMAGE_RUNNING' THEN 'RUNNING'
    WHEN ct."status" = 'IMAGE_QUEUED' THEN 'QUEUED'
    ELSE 'SUCCEEDED'
  END,
  ct."error",
  ct."imageTaskId",
  ct."imageAssetId",
  ct."createdAt",
  ct."updatedAt"
FROM "CompositionTask" ct
JOIN "Project" p ON p."id" = ct."projectId"
WHERE ct."imageAssetId" IS NOT NULL OR ct."imageTaskId" IS NOT NULL;

UPDATE "CompositionTask" ct
SET "currentImageRunId" = ct."id"
WHERE EXISTS (
  SELECT 1 FROM "CompositionImageRun" cir WHERE cir."id" = ct."id"
);

INSERT INTO "CompositionGridRun" (
  "id",
  "taskId",
  "imageRunId",
  "model",
  "ratio",
  "status",
  "gridAssetId",
  "createdAt",
  "updatedAt"
)
SELECT
  ct."id",
  ct."id",
  ct."currentImageRunId",
  p."imageModel",
  p."ratio",
  'READY',
  ct."gridAssetId",
  ct."createdAt",
  ct."updatedAt"
FROM "CompositionTask" ct
JOIN "Project" p ON p."id" = ct."projectId"
WHERE ct."gridAssetId" IS NOT NULL AND ct."currentImageRunId" IS NOT NULL;

UPDATE "CompositionTask" ct
SET "currentGridRunId" = ct."id"
WHERE EXISTS (
  SELECT 1 FROM "CompositionGridRun" cgr WHERE cgr."id" = ct."id"
);

UPDATE "CompositionCandidate" cc
SET
  "gridRunId" = ct."currentGridRunId",
  "angleLabel" = CASE cc."gridIndex"
    WHEN 1 THEN '远景'
    WHEN 2 THEN '中景'
    WHEN 3 THEN '近景'
    WHEN 4 THEN '侧面'
    WHEN 5 THEN '正面'
    WHEN 6 THEN '背影'
    WHEN 7 THEN '俯拍'
    WHEN 8 THEN '仰拍'
    WHEN 9 THEN '特写'
    ELSE '候选'
  END,
  "appliedMode" = CASE WHEN cc."syncedShotId" IS NOT NULL THEN 'create_shots' ELSE NULL END,
  "appliedAt" = CASE WHEN cc."syncedShotId" IS NOT NULL THEN cc."updatedAt" ELSE NULL END
FROM "CompositionTask" ct
WHERE cc."taskId" = ct."id" AND ct."currentGridRunId" IS NOT NULL;

-- DropIndex
DROP INDEX IF EXISTS "CompositionCandidate_taskId_gridIndex_key";

-- CreateIndex
CREATE INDEX "CompositionImageRun_taskId_createdAt_idx" ON "CompositionImageRun"("taskId", "createdAt");
CREATE INDEX "CompositionImageRun_taskJobId_idx" ON "CompositionImageRun"("taskJobId");
CREATE INDEX "CompositionImageRun_outputAssetId_idx" ON "CompositionImageRun"("outputAssetId");
CREATE INDEX "CompositionGridRun_taskId_createdAt_idx" ON "CompositionGridRun"("taskId", "createdAt");
CREATE INDEX "CompositionGridRun_imageRunId_idx" ON "CompositionGridRun"("imageRunId");
CREATE INDEX "CompositionGridRun_gridAssetId_idx" ON "CompositionGridRun"("gridAssetId");
CREATE UNIQUE INDEX "CompositionCandidate_gridRunId_gridIndex_key" ON "CompositionCandidate"("gridRunId", "gridIndex");
CREATE INDEX "CompositionCandidate_gridRunId_selected_idx" ON "CompositionCandidate"("gridRunId", "selected");
CREATE INDEX "CompositionTask_currentImageRunId_idx" ON "CompositionTask"("currentImageRunId");
CREATE INDEX "CompositionTask_currentGridRunId_idx" ON "CompositionTask"("currentGridRunId");

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_currentImageRunId_fkey" FOREIGN KEY ("currentImageRunId") REFERENCES "CompositionImageRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_currentGridRunId_fkey" FOREIGN KEY ("currentGridRunId") REFERENCES "CompositionGridRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompositionImageRun" ADD CONSTRAINT "CompositionImageRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompositionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompositionImageRun" ADD CONSTRAINT "CompositionImageRun_taskJobId_fkey" FOREIGN KEY ("taskJobId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompositionImageRun" ADD CONSTRAINT "CompositionImageRun_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompositionGridRun" ADD CONSTRAINT "CompositionGridRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompositionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompositionGridRun" ADD CONSTRAINT "CompositionGridRun_imageRunId_fkey" FOREIGN KEY ("imageRunId") REFERENCES "CompositionImageRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompositionGridRun" ADD CONSTRAINT "CompositionGridRun_gridAssetId_fkey" FOREIGN KEY ("gridAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompositionCandidate" ADD CONSTRAINT "CompositionCandidate_gridRunId_fkey" FOREIGN KEY ("gridRunId") REFERENCES "CompositionGridRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
