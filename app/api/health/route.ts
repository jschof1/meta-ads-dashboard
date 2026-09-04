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
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "reachable";
    const snapshot = await prisma.snapshot.findFirst({ orderBy: { capturedAt: "desc" }, select: { capturedAt: true } });
    lastSyncAt = snapshot?.capturedAt.toISOString() ?? null;
  } catch {
    // Health output intentionally omits exception details and connection information.
  }

  return NextResponse.json({
    status: database === "reachable" ? "ok" : "degraded",
    configuration: getSafeEnvironmentStatus(),
    database,
    sync: { status: lastSyncAt ? "completed" : "never", lastSyncAt },
  }, { status: database === "reachable" ? 200 : 503 });
}
