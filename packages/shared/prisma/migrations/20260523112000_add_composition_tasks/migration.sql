-- CreateTable
CREATE TABLE "CompositionTask" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "sceneIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "scriptExcerpt" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "characterStyleIds" JSONB NOT NULL DEFAULT '[]',
    "sceneIds" JSONB NOT NULL DEFAULT '[]',
    "itemIds" JSONB NOT NULL DEFAULT '[]',
    "imageAssetId" TEXT,
    "imageTaskId" TEXT,
    "gridAssetId" TEXT,
    "gridTaskId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompositionCandidate" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "gridIndex" INTEGER NOT NULL,
    "assetId" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "syncedShotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompositionCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompositionTask_episodeId_sceneIndex_key" ON "CompositionTask"("episodeId", "sceneIndex");

-- CreateIndex
CREATE INDEX "CompositionTask_projectId_status_createdAt_idx" ON "CompositionTask"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CompositionTask_imageTaskId_idx" ON "CompositionTask"("imageTaskId");

-- CreateIndex
CREATE INDEX "CompositionTask_gridTaskId_idx" ON "CompositionTask"("gridTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionCandidate_taskId_gridIndex_key" ON "CompositionCandidate"("taskId", "gridIndex");

-- CreateIndex
CREATE INDEX "CompositionCandidate_taskId_selected_idx" ON "CompositionCandidate"("taskId", "selected");

-- CreateIndex
CREATE INDEX "CompositionCandidate_syncedShotId_idx" ON "CompositionCandidate"("syncedShotId");

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "StoryboardEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_imageAssetId_fkey" FOREIGN KEY ("imageAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_imageTaskId_fkey" FOREIGN KEY ("imageTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_gridAssetId_fkey" FOREIGN KEY ("gridAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionTask" ADD CONSTRAINT "CompositionTask_gridTaskId_fkey" FOREIGN KEY ("gridTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionCandidate" ADD CONSTRAINT "CompositionCandidate_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CompositionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionCandidate" ADD CONSTRAINT "CompositionCandidate_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompositionCandidate" ADD CONSTRAINT "CompositionCandidate_syncedShotId_fkey" FOREIGN KEY ("syncedShotId") REFERENCES "Shot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
