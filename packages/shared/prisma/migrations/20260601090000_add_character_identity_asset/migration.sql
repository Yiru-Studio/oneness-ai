ALTER TABLE "Character" ADD COLUMN "identityAssetId" TEXT;

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_identityAssetId_fkey"
  FOREIGN KEY ("identityAssetId") REFERENCES "Asset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
