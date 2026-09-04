-- CreateTable
CREATE TABLE "Snapshot" (
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
CREATE TABLE "AdDaily" (
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
CREATE TABLE "Campaign" (
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
CREATE TABLE "AdSet" (
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
CREATE TABLE "Ad" (
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
CREATE TABLE "Creative" (
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
CREATE TABLE "DailyInsight" (
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
CREATE TABLE "SyncRun" (
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
CREATE TABLE "ActionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "executor" TEXT NOT NULL,
    "result" TEXT
);

-- CreateIndex
CREATE INDEX "Snapshot_capturedAt_idx" ON "Snapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "AdDaily_adId_idx" ON "AdDaily"("adId");

-- CreateIndex
CREATE UNIQUE INDEX "AdDaily_date_adId_key" ON "AdDaily"("date", "adId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_metaId_key" ON "Campaign"("metaId");

-- CreateIndex
CREATE INDEX "Campaign_effectiveStatus_idx" ON "Campaign"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AdSet_metaId_key" ON "AdSet"("metaId");

-- CreateIndex
CREATE INDEX "AdSet_campaignMetaId_idx" ON "AdSet"("campaignMetaId");

-- CreateIndex
CREATE INDEX "AdSet_effectiveStatus_idx" ON "AdSet"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_metaId_key" ON "Ad"("metaId");

-- CreateIndex
CREATE INDEX "Ad_campaignMetaId_idx" ON "Ad"("campaignMetaId");

-- CreateIndex
CREATE INDEX "Ad_adSetMetaId_idx" ON "Ad"("adSetMetaId");

-- CreateIndex
CREATE INDEX "Ad_creativeMetaId_idx" ON "Ad"("creativeMetaId");

-- CreateIndex
CREATE INDEX "Ad_effectiveStatus_idx" ON "Ad"("effectiveStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Creative_metaId_key" ON "Creative"("metaId");

-- CreateIndex
CREATE INDEX "Creative_videoId_idx" ON "Creative"("videoId");

-- CreateIndex
CREATE INDEX "Creative_imageHash_idx" ON "Creative"("imageHash");

-- CreateIndex
CREATE INDEX "DailyInsight_level_entityId_date_idx" ON "DailyInsight"("level", "entityId", "date");

-- CreateIndex
CREATE INDEX "DailyInsight_syncRunId_idx" ON "DailyInsight"("syncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyInsight_date_level_entityId_attributionKey_key" ON "DailyInsight"("date", "level", "entityId", "attributionKey");

-- CreateIndex
CREATE UNIQUE INDEX "SyncRun_lockKey_key" ON "SyncRun"("lockKey");

-- CreateIndex
CREATE INDEX "SyncRun_accountId_status_finishedAt_idx" ON "SyncRun"("accountId", "status", "finishedAt");

-- CreateIndex
CREATE INDEX "SyncRun_accountId_startedAt_idx" ON "SyncRun"("accountId", "startedAt");
