-- CreateTable
CREATE TABLE IF NOT EXISTS "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "window" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "linkClicks" INTEGER NOT NULL,
    "registrations" INTEGER NOT NULL,
    "callsBooked" INTEGER NOT NULL,
    "enrollments" INTEGER NOT NULL,
    "cprCents" INTEGER,
    "ctrLink" REAL,
    "cpmCents" INTEGER,
    "frequency" REAL,
    "raw" TEXT NOT NULL DEFAULT '{}'
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "linkClicks" INTEGER NOT NULL,
    "ctrLink" REAL NOT NULL,
    "registrations" INTEGER NOT NULL,
    "cprCents" INTEGER,
    "frequency" REAL NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "configuredStatus" TEXT,
    "effectiveStatus" TEXT,
    "startDate" TEXT,
    "stopDate" TEXT,
    "raw" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AdSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metaId" TEXT NOT NULL,
    "campaignMetaId" TEXT,
    "name" TEXT NOT NULL,
    "configuredStatus" TEXT,
    "effectiveStatus" TEXT,
    "optimisationGoal" TEXT,
    "billingEvent" TEXT,
    "dailyBudgetMinor" INTEGER,
    "lifetimeBudgetMinor" INTEGER,
    "startDate" TEXT,
    "endDate" TEXT,
    "learningStage" TEXT,
    "learningStageInfo" TEXT NOT NULL DEFAULT '{}',
    "raw" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Ad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metaId" TEXT NOT NULL,
    "campaignMetaId" TEXT,
    "adSetMetaId" TEXT,
    "name" TEXT NOT NULL,
    "configuredStatus" TEXT,
    "effectiveStatus" TEXT,
    "creativeMetaId" TEXT,
    "raw" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Creative" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metaId" TEXT NOT NULL,
    "name" TEXT,
    "title" TEXT,
    "body" TEXT,
    "callToActionType" TEXT,
    "thumbnailUrl" TEXT,
    "imageHash" TEXT,
    "imageUrl" TEXT,
    "videoId" TEXT,
    "objectId" TEXT,
    "destinationUrl" TEXT,
    "urlTags" TEXT,
    "format" TEXT,
    "raw" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailyInsight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "attributionKey" TEXT NOT NULL,
    "currencyCode" TEXT,
    "spendMinorUnits" INTEGER,
    "impressions" INTEGER,
    "reach" INTEGER,
    "clicks" INTEGER,
    "linkClicks" INTEGER,
    "leads" INTEGER,
    "cplMinorUnits" INTEGER,
    "cpcMinorUnits" INTEGER,
    "cpmMinorUnits" INTEGER,
    "ctrLink" REAL,
    "frequency" REAL,
    "resultActionType" TEXT,
    "rawActions" TEXT NOT NULL DEFAULT '[]',
    "raw" TEXT NOT NULL DEFAULT '{}',
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "currencyCode" TEXT,
    "timezoneName" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "apiVersion" TEXT,
    "attributionKey" TEXT NOT NULL,
    "requestedSince" TEXT,
    "requestedUntil" TEXT,
    "initialBackfill" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "rowsFetched" INTEGER NOT NULL DEFAULT 0,
    "rowsWritten" INTEGER NOT NULL DEFAULT 0,
    "warning" TEXT,
    "error" TEXT,
    "traceId" TEXT,
    "apiDiagnostics" TEXT,
    "lockKey" TEXT,
    "lockOwner" TEXT,
    "lockExpiresAt" DATETIME
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "executor" TEXT NOT NULL,
    "result" TEXT
);

-- Fail closed for same-named but incompatible tables. SQLite's
-- CREATE TABLE IF NOT EXISTS is intentionally idempotent, but it otherwise
-- hides a legacy schema mismatch. These zero-row reads force SQLite to
-- resolve every required column before the migration records success.
SELECT "Snapshot"."id", "Snapshot"."capturedAt", "Snapshot"."window", "Snapshot"."spendCents", "Snapshot"."impressions", "Snapshot"."clicks", "Snapshot"."linkClicks", "Snapshot"."registrations", "Snapshot"."callsBooked", "Snapshot"."enrollments", "Snapshot"."cprCents", "Snapshot"."ctrLink", "Snapshot"."cpmCents", "Snapshot"."frequency", "Snapshot"."raw" FROM "Snapshot" WHERE 0;
SELECT "AdDaily"."id", "AdDaily"."date", "AdDaily"."adId", "AdDaily"."adName", "AdDaily"."status", "AdDaily"."spendCents", "AdDaily"."impressions", "AdDaily"."linkClicks", "AdDaily"."ctrLink", "AdDaily"."registrations", "AdDaily"."cprCents", "AdDaily"."frequency" FROM "AdDaily" WHERE 0;
SELECT "Campaign"."id", "Campaign"."metaId", "Campaign"."name", "Campaign"."objective", "Campaign"."configuredStatus", "Campaign"."effectiveStatus", "Campaign"."startDate", "Campaign"."stopDate", "Campaign"."raw", "Campaign"."createdAt", "Campaign"."updatedAt" FROM "Campaign" WHERE 0;
SELECT "AdSet"."id", "AdSet"."metaId", "AdSet"."campaignMetaId", "AdSet"."name", "AdSet"."configuredStatus", "AdSet"."effectiveStatus", "AdSet"."optimisationGoal", "AdSet"."billingEvent", "AdSet"."dailyBudgetMinor", "AdSet"."lifetimeBudgetMinor", "AdSet"."startDate", "AdSet"."endDate", "AdSet"."learningStage", "AdSet"."learningStageInfo", "AdSet"."raw", "AdSet"."createdAt", "AdSet"."updatedAt" FROM "AdSet" WHERE 0;
SELECT "Ad"."id", "Ad"."metaId", "Ad"."campaignMetaId", "Ad"."adSetMetaId", "Ad"."name", "Ad"."configuredStatus", "Ad"."effectiveStatus", "Ad"."creativeMetaId", "Ad"."raw", "Ad"."createdAt", "Ad"."updatedAt" FROM "Ad" WHERE 0;
SELECT "Creative"."id", "Creative"."metaId", "Creative"."name", "Creative"."title", "Creative"."body", "Creative"."callToActionType", "Creative"."thumbnailUrl", "Creative"."imageHash", "Creative"."imageUrl", "Creative"."videoId", "Creative"."objectId", "Creative"."destinationUrl", "Creative"."urlTags", "Creative"."format", "Creative"."raw", "Creative"."createdAt", "Creative"."updatedAt" FROM "Creative" WHERE 0;
SELECT "DailyInsight"."id", "DailyInsight"."date", "DailyInsight"."level", "DailyInsight"."entityId", "DailyInsight"."attributionKey", "DailyInsight"."currencyCode", "DailyInsight"."spendMinorUnits", "DailyInsight"."impressions", "DailyInsight"."reach", "DailyInsight"."clicks", "DailyInsight"."linkClicks", "DailyInsight"."leads", "DailyInsight"."cplMinorUnits", "DailyInsight"."cpcMinorUnits", "DailyInsight"."cpmMinorUnits", "DailyInsight"."ctrLink", "DailyInsight"."frequency", "DailyInsight"."resultActionType", "DailyInsight"."rawActions", "DailyInsight"."raw", "DailyInsight"."observedAt", "DailyInsight"."syncRunId" FROM "DailyInsight" WHERE 0;
SELECT "SyncRun"."id", "SyncRun"."accountId", "SyncRun"."accountName", "SyncRun"."currencyCode", "SyncRun"."timezoneName", "SyncRun"."trigger", "SyncRun"."status", "SyncRun"."apiVersion", "SyncRun"."attributionKey", "SyncRun"."requestedSince", "SyncRun"."requestedUntil", "SyncRun"."initialBackfill", "SyncRun"."startedAt", "SyncRun"."finishedAt", "SyncRun"."rowsFetched", "SyncRun"."rowsWritten", "SyncRun"."warning", "SyncRun"."error", "SyncRun"."traceId", "SyncRun"."apiDiagnostics", "SyncRun"."lockKey", "SyncRun"."lockOwner", "SyncRun"."lockExpiresAt" FROM "SyncRun" WHERE 0;
SELECT "ActionLog"."id", "ActionLog"."createdAt", "ActionLog"."action", "ActionLog"."targetId", "ActionLog"."reasoning", "ActionLog"."executor", "ActionLog"."result" FROM "ActionLog" WHERE 0;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Snapshot_capturedAt_idx" ON "Snapshot"("capturedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdDaily_adId_idx" ON "AdDaily"("adId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdDaily_date_adId_key" ON "AdDaily"("date", "adId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_metaId_key" ON "Campaign"("metaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_effectiveStatus_idx" ON "Campaign"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AdSet_metaId_key" ON "AdSet"("metaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdSet_campaignMetaId_idx" ON "AdSet"("campaignMetaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdSet_effectiveStatus_idx" ON "AdSet"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Ad_metaId_key" ON "Ad"("metaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_campaignMetaId_idx" ON "Ad"("campaignMetaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_adSetMetaId_idx" ON "Ad"("adSetMetaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_creativeMetaId_idx" ON "Ad"("creativeMetaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_effectiveStatus_idx" ON "Ad"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Creative_metaId_key" ON "Creative"("metaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Creative_videoId_idx" ON "Creative"("videoId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Creative_imageHash_idx" ON "Creative"("imageHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyInsight_level_entityId_date_idx" ON "DailyInsight"("level", "entityId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DailyInsight_syncRunId_idx" ON "DailyInsight"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DailyInsight_date_level_entityId_attributionKey_key" ON "DailyInsight"("date", "level", "entityId", "attributionKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncRun_lockKey_key" ON "SyncRun"("lockKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncRun_accountId_status_finishedAt_idx" ON "SyncRun"("accountId", "status", "finishedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncRun_accountId_startedAt_idx" ON "SyncRun"("accountId", "startedAt");
