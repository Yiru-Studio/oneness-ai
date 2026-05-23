-- Track the real image-generation task behind each composition storyboard grid run.
ALTER TABLE "CompositionGridRun" ADD COLUMN "taskJobId" TEXT;

ALTER TABLE "CompositionGridRun"
  ADD CONSTRAINT "CompositionGridRun_taskJobId_fkey"
  FOREIGN KEY ("taskJobId") REFERENCES "Task"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CompositionGridRun_taskJobId_idx" ON "CompositionGridRun"("taskJobId");
