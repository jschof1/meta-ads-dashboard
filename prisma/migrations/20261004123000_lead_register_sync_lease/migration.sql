CREATE TABLE "LeadRegisterSyncLease" (
  "locationId" TEXT NOT NULL PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
