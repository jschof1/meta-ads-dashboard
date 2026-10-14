import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { validateDatabaseEnvironment } from "@/lib/env";
import { readMonthlyPerformance } from "@/lib/monthly-performance-store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  if (validateDatabaseEnvironment().length) return NextResponse.json({ error: "Reporting storage is unavailable." }, { status: 503, headers });
  try { return NextResponse.json(await readMonthlyPerformance(), { headers }); }
  catch { return NextResponse.json({ error: "Monthly report could not be read. Retry reading the saved data." }, { status: 503, headers }); }
}
