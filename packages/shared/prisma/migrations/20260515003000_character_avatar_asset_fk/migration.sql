-- Replace Character.avatarKey (string) with Character.avatarAssetId (FK to Asset)
ALTER TABLE "Character" DROP COLUMN "avatarKey";
ALTER TABLE "Character" ADD COLUMN "avatarAssetId" TEXT;

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_avatarAssetId_fkey"
  FOREIGN KEY ("avatarAssetId") REFERENCES "Asset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
