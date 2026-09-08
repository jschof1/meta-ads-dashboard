import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { validateDatabaseEnvironment } from "@/lib/env";
import { buildDashboardState } from "@/lib/read-model";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  if (validateDatabaseEnvironment().length > 0) {
    return NextResponse.json(
      { error: "Dashboard data is unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  try {
    return NextResponse.json(await buildDashboardState(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("dashboard state failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json(
      { error: "Dashboard data is unavailable" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
