-- CreateTable
CREATE TABLE IF NOT EXISTS "AiBriefing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "attributionKey" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dataHash" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '[]',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "sourceSyncRunId" TEXT NOT NULL,
    "snapshotKey" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiBriefing_sourceSyncRunId_fkey" FOREIGN KEY ("sourceSyncRunId") REFERENCES "SyncRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AiBriefing_snapshotKey_key" ON "AiBriefing"("snapshotKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiBriefing_kind_accountId_campaignId_attributionKey_generatedAt_idx"
ON "AiBriefing"("kind", "accountId", "campaignId", "attributionKey", "generatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiBriefing_dataHash_idx" ON "AiBriefing"("dataHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiBriefing_sourceSyncRunId_idx" ON "AiBriefing"("sourceSyncRunId");
