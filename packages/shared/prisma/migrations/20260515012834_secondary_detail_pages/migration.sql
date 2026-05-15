-- AlterTable
ALTER TABLE "CharacterStyle" ADD COLUMN     "model" TEXT,
ADD COLUMN     "prompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ratio" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "model" TEXT,
ADD COLUMN     "prompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ratio" TEXT;

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "model" TEXT,
ADD COLUMN     "prompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ratio" TEXT;
