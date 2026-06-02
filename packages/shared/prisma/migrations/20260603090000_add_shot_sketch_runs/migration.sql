-- CreateTable
CREATE TABLE "ShotSketchRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'generated',
    "prompt" TEXT NOT NULL DEFAULT '',
    "model" TEXT,
    "ratio" TEXT,
    "referenceAssetIds" JSONB NOT NULL DEFAULT '[]',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "taskJobId" TEXT,
    "outputAssetId" TEXT,
    "sourceAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShotSketchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShotSketchRun_projectId_createdAt_idx" ON "ShotSketchRun"("projectId", "createdAt");
CREATE INDEX "ShotSketchRun_episodeId_shotId_createdAt_idx" ON "ShotSketchRun"("episodeId", "shotId", "createdAt");
CREATE INDEX "ShotSketchRun_shotId_createdAt_idx" ON "ShotSketchRun"("shotId", "createdAt");
CREATE INDEX "ShotSketchRun_taskJobId_idx" ON "ShotSketchRun"("taskJobId");
CREATE INDEX "ShotSketchRun_outputAssetId_idx" ON "ShotSketchRun"("outputAssetId");
CREATE INDEX "ShotSketchRun_sourceAssetId_idx" ON "ShotSketchRun"("sourceAssetId");

-- AddForeignKey
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "StoryboardEpisode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_shotId_fkey" FOREIGN KEY ("shotId") REFERENCES "Shot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_taskJobId_fkey" FOREIGN KEY ("taskJobId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShotSketchRun" ADD CONSTRAINT "ShotSketchRun_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill generated sketch runs from legacy shot sketch tasks.
INSERT INTO "ShotSketchRun" (
    "id",
    "projectId",
    "episodeId",
    "shotId",
    "source",
    "prompt",
    "model",
    "ratio",
    "referenceAssetIds",
    "params",
    "status",
    "error",
    "taskJobId",
    "outputAssetId",
    "createdAt",
    "updatedAt"
)
SELECT
    'ssr_' || s.id || '_' || t.id,
    e."projectId",
    s."episodeId",
    s.id,
    'generated',
    COALESCE(t.input->>'prompt', ''),
    t.input->>'model',
    t.input->>'ratio',
    COALESCE(t.input->'referenceAssetIds', '[]'::jsonb),
    jsonb_build_object('legacy', true),
    t.status::text,
    t.error,
    t.id,
    COALESCE(s."sketchAssetId", out."assetId"),
    t."createdAt",
    t."updatedAt"
FROM "Shot" s
JOIN "StoryboardEpisode" e ON e.id = s."episodeId"
JOIN "Task" t ON t.id = s."sketchTaskId"
LEFT JOIN LATERAL (
    SELECT ta."assetId"
    FROM "TaskAsset" ta
    JOIN "Asset" a ON a.id = ta."assetId"
    WHERE ta."taskId" = t.id AND ta.role = 'output'
    ORDER BY a."createdAt" DESC
    LIMIT 1
) out ON TRUE
WHERE s."sketchTaskId" IS NOT NULL;

-- Backfill applied/current images that do not have a generated run.
INSERT INTO "ShotSketchRun" (
    "id",
    "projectId",
    "episodeId",
    "shotId",
    "source",
    "prompt",
    "referenceAssetIds",
    "params",
    "status",
    "outputAssetId",
    "sourceAssetId",
    "createdAt",
    "updatedAt"
)
SELECT
    'ssr_applied_' || s.id || '_' || s."sketchAssetId",
    e."projectId",
    s."episodeId",
    s.id,
    'manual',
    '',
    '[]'::jsonb,
    jsonb_build_object('legacy', true),
    'APPLIED',
    s."sketchAssetId",
    s."sketchAssetId",
    s."updatedAt",
    s."updatedAt"
FROM "Shot" s
JOIN "StoryboardEpisode" e ON e.id = s."episodeId"
WHERE s."sketchAssetId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ShotSketchRun" r
    WHERE r."shotId" = s.id AND r."outputAssetId" = s."sketchAssetId"
  );
