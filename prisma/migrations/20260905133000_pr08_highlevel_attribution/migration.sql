-- Read-only HighLevel attribution snapshot and audit tables.
CREATE TABLE IF NOT EXISTS "CrmSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL DEFAULT 'highlevel',
    "locationId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "apiVersion" TEXT NOT NULL,
    "mappingHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "contactsFetched" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesFetched" INTEGER NOT NULL DEFAULT 0,
    "contactsWritten" INTEGER NOT NULL DEFAULT 0,
    "opportunitiesWritten" INTEGER NOT NULL DEFAULT 0,
    "warning" TEXT,
    "error" TEXT,
    "traceId" TEXT,
    "lockKey" TEXT,
    "lockOwner" TEXT,
    "lockExpiresAt" DATETIME
);

CREATE TABLE IF NOT EXISTS "CrmContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "highLevelId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dateAdded" TEXT,
    "dateUpdated" TEXT,
    "attributionGranularity" TEXT NOT NULL,
    "metaAdId" TEXT,
    "metaCampaignId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "clickIds" TEXT NOT NULL DEFAULT '{}',
    "attribution" TEXT NOT NULL DEFAULT '{}',
    "sourceSyncRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrmContact_sourceSyncRunId_fkey" FOREIGN KEY ("sourceSyncRunId") REFERENCES "CrmSyncRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "CrmOpportunity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "highLevelId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT,
    "pipelineId" TEXT NOT NULL,
    "pipelineStageId" TEXT,
    "status" TEXT NOT NULL,
    "semanticStage" TEXT,
    "valueMajorUnits" REAL,
    "createdAtProvider" TEXT,
    "updatedAtProvider" TEXT,
    "lastStageChangeAt" TEXT,
    "lastStatusChangeAt" TEXT,
    "sourceSyncRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrmOpportunity_sourceSyncRunId_fkey" FOREIGN KEY ("sourceSyncRunId") REFERENCES "CrmSyncRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Resolve all required columns so a same-named legacy table cannot silently
-- satisfy this migration with an incompatible shape.
SELECT "CrmSyncRun"."id", "CrmSyncRun"."provider", "CrmSyncRun"."locationId", "CrmSyncRun"."pipelineId", "CrmSyncRun"."apiVersion", "CrmSyncRun"."mappingHash", "CrmSyncRun"."status", "CrmSyncRun"."trigger", "CrmSyncRun"."startedAt", "CrmSyncRun"."finishedAt", "CrmSyncRun"."contactsFetched", "CrmSyncRun"."opportunitiesFetched", "CrmSyncRun"."contactsWritten", "CrmSyncRun"."opportunitiesWritten", "CrmSyncRun"."warning", "CrmSyncRun"."error", "CrmSyncRun"."traceId", "CrmSyncRun"."lockKey", "CrmSyncRun"."lockOwner", "CrmSyncRun"."lockExpiresAt" FROM "CrmSyncRun" WHERE 0;
SELECT "CrmContact"."id", "CrmContact"."highLevelId", "CrmContact"."locationId", "CrmContact"."dateAdded", "CrmContact"."dateUpdated", "CrmContact"."attributionGranularity", "CrmContact"."metaAdId", "CrmContact"."metaCampaignId", "CrmContact"."utmSource", "CrmContact"."utmMedium", "CrmContact"."utmCampaign", "CrmContact"."utmContent", "CrmContact"."clickIds", "CrmContact"."attribution", "CrmContact"."sourceSyncRunId", "CrmContact"."createdAt", "CrmContact"."updatedAt" FROM "CrmContact" WHERE 0;
SELECT "CrmOpportunity"."id", "CrmOpportunity"."highLevelId", "CrmOpportunity"."locationId", "CrmOpportunity"."contactId", "CrmOpportunity"."pipelineId", "CrmOpportunity"."pipelineStageId", "CrmOpportunity"."status", "CrmOpportunity"."semanticStage", "CrmOpportunity"."valueMajorUnits", "CrmOpportunity"."createdAtProvider", "CrmOpportunity"."updatedAtProvider", "CrmOpportunity"."lastStageChangeAt", "CrmOpportunity"."lastStatusChangeAt", "CrmOpportunity"."sourceSyncRunId", "CrmOpportunity"."createdAt", "CrmOpportunity"."updatedAt" FROM "CrmOpportunity" WHERE 0;

CREATE UNIQUE INDEX IF NOT EXISTS "CrmSyncRun_lockKey_key" ON "CrmSyncRun"("lockKey");
CREATE UNIQUE INDEX IF NOT EXISTS "CrmContact_locationId_highLevelId_key" ON "CrmContact"("locationId", "highLevelId");
CREATE INDEX IF NOT EXISTS "CrmSyncRun_locationId_status_finishedAt_idx" ON "CrmSyncRun"("locationId", "status", "finishedAt");
CREATE INDEX IF NOT EXISTS "CrmSyncRun_locationId_startedAt_idx" ON "CrmSyncRun"("locationId", "startedAt");
CREATE INDEX IF NOT EXISTS "CrmSyncRun_locationId_mappingHash_status_finishedAt_idx" ON "CrmSyncRun"("locationId", "mappingHash", "status", "finishedAt");
CREATE INDEX IF NOT EXISTS "CrmContact_locationId_attributionGranularity_idx" ON "CrmContact"("locationId", "attributionGranularity");
CREATE INDEX IF NOT EXISTS "CrmContact_sourceSyncRunId_idx" ON "CrmContact"("sourceSyncRunId");
CREATE INDEX IF NOT EXISTS "CrmContact_locationId_metaCampaignId_idx" ON "CrmContact"("locationId", "metaCampaignId");
CREATE INDEX IF NOT EXISTS "CrmContact_locationId_metaAdId_idx" ON "CrmContact"("locationId", "metaAdId");
CREATE UNIQUE INDEX IF NOT EXISTS "CrmOpportunity_locationId_pipelineId_highLevelId_key" ON "CrmOpportunity"("locationId", "pipelineId", "highLevelId");
CREATE INDEX IF NOT EXISTS "CrmOpportunity_locationId_contactId_idx" ON "CrmOpportunity"("locationId", "contactId");
CREATE INDEX IF NOT EXISTS "CrmOpportunity_pipelineId_semanticStage_idx" ON "CrmOpportunity"("pipelineId", "semanticStage");
CREATE INDEX IF NOT EXISTS "CrmOpportunity_sourceSyncRunId_idx" ON "CrmOpportunity"("sourceSyncRunId");
