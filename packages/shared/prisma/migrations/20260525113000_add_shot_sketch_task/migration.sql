ALTER TABLE "Shot" ADD COLUMN "sketchTaskId" TEXT;

CREATE INDEX "Shot_sketchTaskId_idx" ON "Shot"("sketchTaskId");

ALTER TABLE "Shot" ADD CONSTRAINT "Shot_sketchTaskId_fkey" FOREIGN KEY ("sketchTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
