CREATE TABLE "CustomerJourneySyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "payload" TEXT,
    "error" TEXT,
    "lockKey" TEXT,
    "lockOwner" TEXT,
    "lockExpiresAt" DATETIME
);
CREATE UNIQUE INDEX "CustomerJourneySyncRun_lockKey_key" ON "CustomerJourneySyncRun"("lockKey");
CREATE INDEX "CustomerJourneySyncRun_locationId_stripeAccountId_status_finishedAt_idx" ON "CustomerJourneySyncRun"("locationId", "stripeAccountId", "status", "finishedAt");
