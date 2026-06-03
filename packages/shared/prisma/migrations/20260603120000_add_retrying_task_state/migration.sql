ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'RETRYING';

ALTER TABLE "Task"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firstRetryAt" TIMESTAMP(3),
  ADD COLUMN "lastRetryAt" TIMESTAMP(3),
  ADD COLUMN "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN "retryUntil" TIMESTAMP(3),
  ADD COLUMN "lastRetryError" TEXT;

CREATE INDEX "Task_status_nextRetryAt_idx" ON "Task"("status", "nextRetryAt");
