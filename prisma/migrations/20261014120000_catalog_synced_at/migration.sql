-- Last full catalog detect (manual "Detect filter values" or webhook re-check).
ALTER TABLE "FilterSettings" ADD COLUMN IF NOT EXISTS "catalogSyncedAt" TIMESTAMP(3);
