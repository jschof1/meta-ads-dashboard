import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { readBusinessOutcomes } from "@/lib/business-outcomes";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  if (!process.env.HIGHLEVEL_TOKEN || !process.env.HIGHLEVEL_LOCATION_ID || !process.env.HIGHLEVEL_SALES_CALENDAR_ID) {
    return NextResponse.json({ status: "not_configured", error: "Business reporting is not configured." }, { headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    return NextResponse.json(await readBusinessOutcomes(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("business outcomes unavailable", error instanceof Error ? error.name + ": " + error.message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 200) : "unknown");
    return NextResponse.json({ error: "Live business reporting is unavailable. Refresh to retry." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
