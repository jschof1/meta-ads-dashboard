-- Provider timestamps are nullable because Meta may omit them or return them
-- only for some entity types. Existing metadata remains valid without them.
ALTER TABLE "Campaign" ADD COLUMN "dailyBudgetMinor" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "lifetimeBudgetMinor" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN "providerUpdatedAt" DATETIME;
ALTER TABLE "AdSet" ADD COLUMN "providerUpdatedAt" DATETIME;
ALTER TABLE "Ad" ADD COLUMN "providerUpdatedAt" DATETIME;
ALTER TABLE "Creative" ADD COLUMN "providerUpdatedAt" DATETIME;
ALTER TABLE "Campaign" ADD COLUMN "lastSeenSyncRunId" TEXT;
ALTER TABLE "AdSet" ADD COLUMN "lastSeenSyncRunId" TEXT;
ALTER TABLE "Ad" ADD COLUMN "lastSeenSyncRunId" TEXT;
ALTER TABLE "Creative" ADD COLUMN "lastSeenSyncRunId" TEXT;
ALTER TABLE "SyncRun" ADD COLUMN "campaignId" TEXT;
ALTER TABLE "DailyInsight" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'account';
DROP INDEX IF EXISTS "DailyInsight_date_level_entityId_attributionKey_key";
CREATE INDEX "Campaign_lastSeenSyncRunId_idx" ON "Campaign"("lastSeenSyncRunId");
CREATE INDEX "AdSet_lastSeenSyncRunId_idx" ON "AdSet"("lastSeenSyncRunId");
CREATE INDEX "Ad_lastSeenSyncRunId_idx" ON "Ad"("lastSeenSyncRunId");
CREATE INDEX "Creative_lastSeenSyncRunId_idx" ON "Creative"("lastSeenSyncRunId");
CREATE UNIQUE INDEX "DailyInsight_date_level_entityId_attributionKey_scopeKey_key" ON "DailyInsight"("date", "level", "entityId", "attributionKey", "scopeKey");
