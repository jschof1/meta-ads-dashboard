import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { buildDashboardState } from "@/lib/read-model";

export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    return NextResponse.json(await buildDashboardState());
  } catch (error) {
    console.error("dashboard state failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "Dashboard data is unavailable" }, { status: 503 });
  }
}
