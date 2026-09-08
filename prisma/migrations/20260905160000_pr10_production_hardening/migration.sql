-- Durable login rate-limit state shared by all Vercel function instances.
-- The application stores an HMAC digest, never the forwarded IP itself.
CREATE TABLE IF NOT EXISTS "AuthRateLimit" (
    "keyHash" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

SELECT "AuthRateLimit"."keyHash", "AuthRateLimit"."count", "AuthRateLimit"."resetAt", "AuthRateLimit"."updatedAt" FROM "AuthRateLimit" WHERE 0;

CREATE INDEX IF NOT EXISTS "AuthRateLimit_resetAt_idx" ON "AuthRateLimit"("resetAt");

-- An empty recommendation set is an observation too. Preserve its scope-level
-- watermark so delayed analyses cannot insert or reopen obsolete advice.
CREATE TABLE IF NOT EXISTS "RecommendationScopeState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "attributionKey" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "sourceSyncRunId" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

SELECT "id", "accountId", "campaignId", "attributionKey", "ruleVersion", "observedAt", "sourceSyncRunId", "updatedAt" FROM "RecommendationScopeState" WHERE 0;

CREATE INDEX IF NOT EXISTS "RecommendationScopeState_accountId_campaignId_attributionKey_idx" ON "RecommendationScopeState"("accountId", "campaignId", "attributionKey");
