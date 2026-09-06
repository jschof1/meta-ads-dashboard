import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { getSafeEnvironmentStatus } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const configuration = getSafeEnvironmentStatus();
  const databaseConfigured = configuration.database === "configured";

  let database: "reachable" | "unreachable" = "unreachable";
  let lastSyncAt: string | null = null;
  let lastAttemptAt: string | null = null;
  let syncStatus: "completed" | "running" | "failed" | "stale" | "never" | "unknown" = "unknown";
  try {
    if (!databaseConfigured) throw new Error("Database is not configured");
    await prisma.$queryRaw`SELECT 1`;
    database = "reachable";
    const configuredAccount = process.env.META_AD_ACCOUNT_ID?.trim();
    if (!configuredAccount) throw new Error("Meta account is not configured");
    const accountId = configuredAccount.startsWith("act_") ? configuredAccount : `act_${configuredAccount}`;
    const campaignId = process.env.META_CAMPAIGN_ID?.trim() || null;
    const attributionKey = process.env.META_ATTRIBUTION_WINDOWS
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(",") || "7d_click,1d_view";
    const scope = { accountId, campaignId, attributionKey };
    const [latestAttempt, latestSuccess] = await Promise.all([
      prisma.syncRun.findFirst({ where: scope, orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true } }),
      prisma.syncRun.findFirst({ where: { ...scope, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    ]);
    lastSyncAt = latestSuccess?.finishedAt?.toISOString() ?? null;
    lastAttemptAt = latestAttempt?.finishedAt?.toISOString() ?? latestAttempt?.startedAt?.toISOString() ?? null;
    const stale = latestSuccess?.finishedAt
      ? Date.now() - latestSuccess.finishedAt.getTime() > 26 * 60 * 60 * 1_000
      : false;
    syncStatus = latestAttempt?.status === "RUNNING"
      ? "running"
      : latestAttempt?.status === "FAILED"
        ? "failed"
        : lastSyncAt
          ? stale ? "stale" : "completed"
          : "never";
  } catch {
    // Health output intentionally omits exception details and connection information.
    // Only successful scoped reads can establish that a sync has never run.
    syncStatus = "unknown";
    lastSyncAt = null;
    lastAttemptAt = null;
  }

  const available = databaseConfigured && database === "reachable" && syncStatus !== "unknown";
  return NextResponse.json({
    status: available ? "ok" : "degraded",
    configuration,
    database,
    sync: { status: syncStatus, lastSyncAt, lastAttemptAt },
  }, {
    status: available ? 200 : 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
