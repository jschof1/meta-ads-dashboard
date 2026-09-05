-- Approval-gated Meta actions. No provider call is made by this migration.
-- the application starts with META_WRITES_ENABLED=false.
CREATE TABLE IF NOT EXISTS "MetaAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotencyKey" TEXT NOT NULL,
    "actionFingerprint" TEXT NOT NULL,
    "targetLockKey" TEXT,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "attributionKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedChange" TEXT NOT NULL,
    "expectedState" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reasoning" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "recommendationFingerprint" TEXT,
    "sourceSyncRunId" TEXT,
    "metaObjectId" TEXT,
    "metaTraceId" TEXT,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "rejectedAt" DATETIME,
    "rejectedBy" TEXT,
    "executingAt" DATETIME,
    "executedAt" DATETIME,
    "failedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- Add typed audit fields without changing or removing legacy ActionLog rows.
ALTER TABLE "ActionLog" ADD COLUMN "metaActionId" TEXT;
ALTER TABLE "ActionLog" ADD COLUMN "oldValue" TEXT;
ALTER TABLE "ActionLog" ADD COLUMN "newValue" TEXT;
ALTER TABLE "ActionLog" ADD COLUMN "metaReference" TEXT;

-- Resolve every required column so a same-named legacy table cannot silently
-- satisfy this migration with an incompatible shape.
SELECT "MetaAction"."id", "MetaAction"."idempotencyKey", "MetaAction"."actionFingerprint", "MetaAction"."targetLockKey", "MetaAction"."accountId", "MetaAction"."campaignId", "MetaAction"."attributionKey", "MetaAction"."action", "MetaAction"."targetType", "MetaAction"."targetId", "MetaAction"."targetName", "MetaAction"."status", "MetaAction"."requestedChange", "MetaAction"."expectedState", "MetaAction"."oldValue", "MetaAction"."newValue", "MetaAction"."reasoning", "MetaAction"."evidence", "MetaAction"."confidence", "MetaAction"."source", "MetaAction"."recommendationFingerprint", "MetaAction"."sourceSyncRunId", "MetaAction"."metaObjectId", "MetaAction"."metaTraceId", "MetaAction"."error", "MetaAction"."createdAt", "MetaAction"."approvedAt", "MetaAction"."approvedBy", "MetaAction"."rejectedAt", "MetaAction"."rejectedBy", "MetaAction"."executingAt", "MetaAction"."executedAt", "MetaAction"."failedAt", "MetaAction"."updatedAt" FROM "MetaAction" WHERE 0;
SELECT "ActionLog"."id", "ActionLog"."createdAt", "ActionLog"."action", "ActionLog"."targetId", "ActionLog"."reasoning", "ActionLog"."executor", "ActionLog"."result", "ActionLog"."metaActionId", "ActionLog"."oldValue", "ActionLog"."newValue", "ActionLog"."metaReference" FROM "ActionLog" WHERE 0;

CREATE UNIQUE INDEX IF NOT EXISTS "MetaAction_idempotencyKey_key" ON "MetaAction"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "MetaAction_actionFingerprint_key" ON "MetaAction"("actionFingerprint");
CREATE UNIQUE INDEX IF NOT EXISTS "MetaAction_targetLockKey_key" ON "MetaAction"("targetLockKey");
CREATE INDEX IF NOT EXISTS "MetaAction_accountId_campaignId_attributionKey_status_createdAt_idx" ON "MetaAction"("accountId", "campaignId", "attributionKey", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "MetaAction_targetId_status_idx" ON "MetaAction"("targetId", "status");
CREATE INDEX IF NOT EXISTS "MetaAction_recommendationFingerprint_idx" ON "MetaAction"("recommendationFingerprint");
CREATE INDEX IF NOT EXISTS "ActionLog_metaActionId_idx" ON "ActionLog"("metaActionId");
