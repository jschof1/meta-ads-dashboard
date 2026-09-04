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
    const message = error instanceof Error ? error.message : "Dashboard data is unavailable";
    console.error("dashboard state failed:", message);
    return NextResponse.json({ error: "Dashboard data is unavailable" }, { status: 503 });
  }
}
