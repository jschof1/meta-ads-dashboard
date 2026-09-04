import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { getSafeEnvironmentStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;

  let database: "reachable" | "unreachable" = "unreachable";
  let lastSyncAt: string | null = null;
  let lastAttemptAt: string | null = null;
  let syncStatus: "completed" | "running" | "failed" | "never" = "never";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "reachable";
    const [latestAttempt, latestSuccess] = await Promise.all([
      prisma.syncRun.findFirst({ orderBy: { startedAt: "desc" }, select: { status: true, startedAt: true, finishedAt: true } }),
      prisma.syncRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    ]);
    lastSyncAt = latestSuccess?.finishedAt?.toISOString() ?? null;
    lastAttemptAt = latestAttempt?.finishedAt?.toISOString() ?? latestAttempt?.startedAt?.toISOString() ?? null;
    syncStatus = latestAttempt?.status === "RUNNING"
      ? "running"
      : latestAttempt?.status === "FAILED"
        ? "failed"
        : lastSyncAt
          ? "completed"
          : "never";
  } catch {
    // Health output intentionally omits exception details and connection information.
  }

  return NextResponse.json({
    status: database === "reachable" ? "ok" : "degraded",
    configuration: getSafeEnvironmentStatus(),
    database,
    sync: { status: syncStatus, lastSyncAt, lastAttemptAt },
  }, { status: database === "reachable" ? 200 : 503 });
}
