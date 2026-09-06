import { createHmac } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";

export const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
const RETAINED_STATE_MS = 24 * 60 * 60 * 1_000;

export type LoginRateLimitResult = {
  allowed: boolean;
  retryAfter: number;
};

function keyHash(key: string, secret: string): string {
  return createHmac("sha256", secret).update(key).digest("hex");
}

function retryAfter(resetAt: Date | null, now: Date): number {
  return resetAt ? Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1_000)) : LOGIN_RATE_LIMIT_WINDOW_MS / 1_000;
}

export async function checkLoginRateLimit(options: {
  key: string;
  secret: string;
  db?: PrismaClient;
  now?: Date;
}): Promise<LoginRateLimitResult> {
  const db = options.db ?? defaultPrisma;
  const now = options.now ?? new Date();
  const resetAt = new Date(now.getTime() + LOGIN_RATE_LIMIT_WINDOW_MS);
  const digest = keyHash(options.key, options.secret);

  // Bound the table without retaining the source key or relying on a
  // process-local cleanup map that disappears on a Vercel cold start.
  await db.$executeRaw`DELETE FROM "AuthRateLimit" WHERE "resetAt" < ${new Date(now.getTime() - RETAINED_STATE_MS)}`;
  const changed = await db.$executeRaw`
    INSERT INTO "AuthRateLimit" ("keyHash", "count", "resetAt", "updatedAt")
    VALUES (${digest}, 1, ${resetAt}, ${now})
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE WHEN "AuthRateLimit"."resetAt" <= ${now} THEN 1 ELSE "AuthRateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "AuthRateLimit"."resetAt" <= ${now} THEN ${resetAt} ELSE "AuthRateLimit"."resetAt" END,
      "updatedAt" = ${now}
    WHERE "AuthRateLimit"."resetAt" <= ${now}
       OR "AuthRateLimit"."count" < ${LOGIN_RATE_LIMIT_MAX_ATTEMPTS}
  `;
  const row = await db.authRateLimit.findUnique({ where: { keyHash: digest }, select: { count: true, resetAt: true } });
  if (changed === 0 || !row || row.count > LOGIN_RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, retryAfter: retryAfter(row?.resetAt ?? null, now) };
  }
  return { allowed: true, retryAfter: 0 };
}

export async function clearLoginRateLimit(options: {
  key: string;
  secret: string;
  db?: PrismaClient;
}): Promise<void> {
  const db = options.db ?? defaultPrisma;
  await db.authRateLimit.deleteMany({ where: { keyHash: keyHash(options.key, options.secret) } });
}
