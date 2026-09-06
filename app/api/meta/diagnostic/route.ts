import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import {
  diagnoseResultEvents,
  MetaApiError,
  createMetaClient,
} from "@/lib/meta";
import { redactSensitiveData } from "@/lib/safe-json";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

// Protected operator diagnostic. It returns Meta data and diagnostics but no
// token, request URL, Authorization header or other credential material.
export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const client = createMetaClient();
    const [account, campaigns, adSets, ads, creatives, accountInsight, adInsights] = await Promise.all([
      client.getAccount(),
      client.listCampaigns(),
      client.listAdSets(),
      client.listAds(),
      client.listCreatives(),
      client.getAccountRollup("last_30d"),
      client.getAdDaily("last_30d"),
    ]);
    const insightRows = [accountInsight, ...adInsights].filter((row): row is NonNullable<typeof row> => row !== null);
    const resultEventOptions = {
      primaryActionType: process.env.META_PRIMARY_RESULT_ACTION_TYPE || undefined,
      customConversionId: process.env.META_CUSTOM_CONVERSION_ID || undefined,
    };

    return NextResponse.json({
      ok: true,
      account: redactSensitiveData(account),
      campaigns: redactSensitiveData(campaigns),
      adSets: redactSensitiveData(adSets),
      ads: redactSensitiveData(ads),
      creatives: redactSensitiveData(creatives),
      insights: redactSensitiveData({ accountRollup: accountInsight, adDaily: adInsights }),
      actionTypeDiagnostics: insightRows.map((row) => ({
        adId: row.ad_id ?? null,
        date: row.date_start ?? null,
        ...diagnoseResultEvents(row, resultEventOptions),
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const diagnostic = error instanceof MetaApiError
      ? { kind: error.kind, status: error.status, code: error.code, subcode: error.subcode, traceId: error.traceId }
      : { kind: "unknown" };
    console.error("Meta diagnostic failed:", diagnostic);
    return NextResponse.json(
      { ok: false, error: "Meta diagnostic failed; see server logs for redacted provider diagnostics." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
