import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { acquisitionQuery, buildAcquisitionReport } from "@/lib/acquisition-report";
import { readCustomerJourney } from "@/lib/customer-journey-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request); if (unauthorized) return unauthorized;
  let query;
  try { query = acquisitionQuery(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "Choose valid dates from January 2026 onwards and a supported comparison." }, { status: 400, headers }); }
  try {
    const accountId = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, "");
    if (!accountId || process.env.META_CAMPAIGN_ID) throw new Error("Account-wide reporting configuration required");
    const attributionKey = (process.env.META_ATTRIBUTION_WINDOWS || "7d_click,1d_view").split(",").map(v => v.trim()).filter(Boolean).join(",");
    const [insights, runs, ads, adsets, campaigns, journey, latestMetaAttempt] = await Promise.all([
      prisma.dailyInsight.findMany({ where: { attributionKey, scopeKey: "account", date: { gte: "2026-01-01" }, level: query.level } }),
      prisma.syncRun.findMany({ where: { accountId: `act_${accountId}`, campaignId: null, attributionKey, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
      prisma.ad.findMany(), prisma.adSet.findMany(), prisma.campaign.findMany(), readCustomerJourney(),
      prisma.syncRun.findFirst({ where: { accountId: `act_${accountId}`, campaignId: null, attributionKey }, orderBy: { startedAt: "desc" } }),
    ]);
    if (runs.some(r => r.currencyCode && r.currencyCode !== "GBP")) throw new Error("Reporting currency mismatch");
    const names = new Map<string, string>([...ads, ...adsets, ...campaigns].map(a => [a.metaId, a.name]));
    for (const row of insights) if (!names.has(row.entityId)) {
      const raw = JSON.parse(row.raw); names.set(row.entityId, raw.ad_name ?? raw.adset_name ?? raw.campaign_name ?? row.entityId);
    }
    const adSetAttribution = adsets.map(a => ({ id: a.metaId, name: a.name, specification: JSON.parse(a.raw).attribution_spec ?? null }));
    return NextResponse.json(buildAcquisitionReport({ query, insights, runs, names, journey: journey.snapshot, latestJourneyAttempt: journey.attempt, latestMetaAttempt, attributionKey, adSetAttribution }), { headers });
  } catch {
    return NextResponse.json({ error: "Customer acquisition reporting unavailable. Existing dashboard data is preserved; check migration and sync status." }, { status: 503, headers });
  }
}
