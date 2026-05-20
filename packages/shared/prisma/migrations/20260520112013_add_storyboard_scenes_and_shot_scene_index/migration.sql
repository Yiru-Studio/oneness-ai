-- AlterTable
ALTER TABLE "Shot" ADD COLUMN     "roleNames" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "sceneIndex" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StoryboardEpisode" ADD COLUMN     "scenesJson" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "Shot_episodeId_sceneIndex_idx" ON "Shot"("episodeId", "sceneIndex");
