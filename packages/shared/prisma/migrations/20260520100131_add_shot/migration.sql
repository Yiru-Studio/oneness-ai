-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "shotType" TEXT NOT NULL DEFAULT 'new',
    "preId" INTEGER,
    "duration" INTEGER NOT NULL DEFAULT 4,
    "prompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT 'seedance',
    "ratio" TEXT NOT NULL DEFAULT '16:9',
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "generateAudio" BOOLEAN NOT NULL DEFAULT false,
    "createType" TEXT NOT NULL DEFAULT 'manual',
    "sketchAssetId" TEXT,
    "videoAssetId" TEXT,
    "lastFrameAssetId" TEXT,
    "videoTaskId" TEXT,
    "characterStyleIds" JSONB NOT NULL DEFAULT '[]',
    "sceneIds" JSONB NOT NULL DEFAULT '[]',
    "itemIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shot_episodeId_idx" ON "Shot"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_episodeId_displayId_key" ON "Shot"("episodeId", "displayId");

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "StoryboardEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_sketchAssetId_fkey" FOREIGN KEY ("sketchAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_lastFrameAssetId_fkey" FOREIGN KEY ("lastFrameAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_videoTaskId_fkey" FOREIGN KEY ("videoTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
