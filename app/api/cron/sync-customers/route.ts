import { NextResponse } from "next/server";
import { syncCustomerJourney, JourneySyncRunningError } from "@/lib/customer-journey-store";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.CUSTOMER_JOURNEY_SYNC_ENABLED !== "true") return NextResponse.json({ ok: true, skipped: "Customer sync is disabled" });
  try {
    const snapshot = await syncCustomerJourney();
    return NextResponse.json({ ok: true, checkedAt: snapshot.checkedAt, contacts: snapshot.contacts.length, unmatchedCustomers: snapshot.health.unmatchedCustomers, ambiguousCustomers: snapshot.health.ambiguousCustomers });
  } catch (error) {
    if (error instanceof JourneySyncRunningError) return NextResponse.json({ error: "Customer refresh already running" }, { status: 409 });
    console.error("Customer journey sync failed", { kind: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Customer refresh failed; last complete snapshot retained" }, { status: 503 });
  }
}
