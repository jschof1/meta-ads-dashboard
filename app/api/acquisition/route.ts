import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { acquisitionQuery, buildAcquisitionReport } from "@/lib/acquisition-report";
import { readCustomerJourney } from "@/lib/customer-journey-store";
import { acquisitionInsightSnapshot } from "@/lib/acquisition-insight-snapshot";
import { ownedAcquisitionCatalogue } from "@/lib/acquisition-catalogue";
import { UKTL_META_ACCOUNT } from "@/lib/customer-journey";

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
    if (`act_${accountId}` !== UKTL_META_ACCOUNT || process.env.META_CAMPAIGN_ID) throw new Error("UKTL account-wide reporting configuration required");
    const attributionKey = (process.env.META_ATTRIBUTION_WINDOWS || "7d_click,1d_view").split(",").map(v => v.trim()).filter(Boolean).join(",");
    const [[savedInsights, runs, ads, adsets, campaigns, latestMetaAttempt], journey] = await Promise.all([prisma.$transaction([
      prisma.dailyInsight.findMany({ where: { attributionKey, scopeKey: "account", date: { gte: "2026-01-01" }, level: { in: [...new Set([query.level, "ad"])] } } }),
      prisma.syncRun.findMany({ where: { accountId: `act_${accountId}`, campaignId: null, attributionKey, status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } }),
      prisma.ad.findMany(), prisma.adSet.findMany(), prisma.campaign.findMany(),
      prisma.syncRun.findFirst({ where: { accountId: `act_${accountId}`, campaignId: null, attributionKey }, orderBy: { startedAt: "desc" } }),
    ]), readCustomerJourney()]);
    if (runs.some(r => r.currencyCode && r.currencyCode !== "GBP")) throw new Error("Reporting currency mismatch");
    const { rows: insights, omittedRows } = acquisitionInsightSnapshot(savedInsights, runs, process.env.META_PRIMARY_RESULT_ACTION_TYPE);
    const catalogue = ownedAcquisitionCatalogue({ accountId: `act_${accountId}`, runs, history: savedInsights, ads, adSets: adsets, campaigns });
    const names = new Map<string, string>([...catalogue.ads, ...catalogue.adSets, ...catalogue.campaigns].map(a => [a.metaId, a.name]));
    for (const row of insights) if (!names.has(row.entityId)) {
      const raw = JSON.parse(row.raw); names.set(row.entityId, raw.ad_name ?? raw.adset_name ?? raw.campaign_name ?? row.entityId);
    }
    const adSetAttribution = catalogue.adSets.map(a => ({ id: a.metaId, name: a.name, specification: JSON.parse(a.raw).attribution_spec ?? null }));
    return NextResponse.json(buildAcquisitionReport({ query, insights, runs, names, journey: journey.snapshot, latestJourneyAttempt: journey.attempt, latestMetaAttempt, attributionKey, adSetAttribution, metaOmittedRows: omittedRows }), { headers });
  } catch {
    return NextResponse.json({ error: "Customer acquisition reporting unavailable. Existing dashboard data is preserved; check migration and sync status." }, { status: 503, headers });
  }
}
