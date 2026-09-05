-- Deterministic recommendations are durable analysis output, not live API
-- state. The fingerprint makes repeated syncs idempotent within a scope.
CREATE TABLE IF NOT EXISTS "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "attributionKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "analysisWindowDays" INTEGER NOT NULL,
    "ruleVersion" TEXT NOT NULL DEFAULT 'pr06.v1',
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "lifecycle" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '{}',
    "proposedAction" TEXT NOT NULL,
    "sourceSyncRunId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "Recommendation_fingerprint_key" ON "Recommendation"("fingerprint");
CREATE INDEX IF NOT EXISTS "Recommendation_accountId_campaignId_attributionKey_lifecycle_idx" ON "Recommendation"("accountId", "campaignId", "attributionKey", "lifecycle");
CREATE INDEX IF NOT EXISTS "Recommendation_targetId_lastSeenAt_idx" ON "Recommendation"("targetId", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "Recommendation_sourceSyncRunId_idx" ON "Recommendation"("sourceSyncRunId");
