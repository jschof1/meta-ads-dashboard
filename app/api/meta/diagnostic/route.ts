import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import {
  diagnoseResultEvents,
  MetaApiError,
  createMetaClient,
} from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
      account,
      campaigns,
      adSets,
      ads,
      creatives,
      insights: { accountRollup: accountInsight, adDaily: adInsights },
      actionTypeDiagnostics: insightRows.map((row) => ({
        adId: row.ad_id ?? null,
        date: row.date_start ?? null,
        ...diagnoseResultEvents(row, resultEventOptions),
      })),
    });
  } catch (error) {
    const message = error instanceof MetaApiError ? error.message : "Meta diagnostic failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
