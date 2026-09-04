import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { formatMoney } from "@/lib/format";
import { readPlan } from "@/lib/plan-context";
import { requireApiSession } from "@/lib/api-auth";
import { buildDashboardState } from "@/lib/read-model";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Anomaly = { metric: string; direction: string; changePct: number; message: string; severity: string };
type Bucket = { spendCents?: number | null; leads?: number | null; cplCents?: number | null; ctrLink?: number | null; cpmCents?: number | null; frequency?: number | null };
type DashboardState = {
  scorecard?: {
    today?: Bucket;
    yesterday?: Bucket;
    last7?: Bucket;
    last30?: Bucket;
    leadsThisWeek?: number | null;
    learningLeadsTarget?: number | null;
  };
  ads?: Array<{ adName?: string; cplCents?: number | null; spendCents?: number | null; leads?: number | null; status?: string; fatigueScore?: number | null; fatigueReason?: string | null }>;
  funnel?: { leads?: number | null; contacted?: number | null; qualified?: number | null; callsBooked?: number | null; callsAttended?: number | null; wonCustomers?: number | null; lostCustomers?: number | null };
  anomalies?: Anomaly[];
  meta?: { daysSinceLaunch?: number | null; currencyCode?: string | null; timezoneName?: string | null };
};

type CacheEntry = { key: string; text: string; at: number };
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000;

function fmtMoney(value: number | undefined | null, currencyCode: string | null | undefined) {
  return value == null ? "n/a" : formatMoney(value, currencyCode);
}

function fmtCount(value: number | undefined | null): string {
  return value == null ? "n/a" : new Intl.NumberFormat("en-GB").format(value);
}

function dayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`;
}

export async function POST(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ summary: "ANTHROPIC_API_KEY not set. AI summary disabled." });
  }

  try {
    // Rehydrate evidence on the server. The browser is an untrusted caller and
    // must not be able to forge metrics, currency, or funnel outcomes.
    const state = await buildDashboardState();
    return await generateSummary(state, apiKey);
  } catch (error) {
    console.error("AI summary data load failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ summary: "AI summary unavailable; dashboard data could not be read.", error: true }, { status: 503 });
  }
}

async function generateSummary(state: DashboardState, apiKey: string) {

  const cacheKey = `${dayKey()}::${JSON.stringify(state.scorecard || {})}::${JSON.stringify(state.funnel || {})}::${state.meta?.currencyCode ?? ""}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ summary: cache.text, cached: true });
  }

  const currencyCode = state.meta?.currencyCode;
  const plan = await readPlan();
  const today = state.scorecard?.today;
  const yest = state.scorecard?.yesterday;
  const last7 = state.scorecard?.last7;
  const last30 = state.scorecard?.last30;
  const ads = state.ads || [];
  const funnel = state.funnel || {};
  const anomalies = state.anomalies || [];
  const dsl = state.meta?.daysSinceLaunch;
  const learningTarget = state.scorecard?.learningLeadsTarget;
  const learningSummary = learningTarget == null
    ? `${fmtCount(state.scorecard?.leadsThisWeek)} (learning lead target not set)`
    : `${fmtCount(state.scorecard?.leadsThisWeek)} / ${learningTarget}`;
  const fatiguedAds = ads.filter((ad) => ad.fatigueScore != null && ad.fatigueScore >= 0.5).slice(0, 5);

  const summary = `
Today: spend ${fmtMoney(today?.spendCents, currencyCode)}, leads ${fmtCount(today?.leads)}, CPL ${fmtMoney(today?.cplCents, currencyCode)}.
Yesterday: spend ${fmtMoney(yest?.spendCents, currencyCode)}, leads ${fmtCount(yest?.leads)}, CPL ${fmtMoney(yest?.cplCents, currencyCode)}.
Last 7d: spend ${fmtMoney(last7?.spendCents, currencyCode)}, leads ${fmtCount(last7?.leads)}, CPL ${fmtMoney(last7?.cplCents, currencyCode)}, CTR ${last7?.ctrLink != null ? (last7.ctrLink * 100).toFixed(2) + "%" : "n/a"}, CPM ${fmtMoney(last7?.cpmCents, currencyCode)}, frequency ${last7?.frequency?.toFixed(2) ?? "n/a"}.
Last 30d: spend ${fmtMoney(last30?.spendCents, currencyCode)}, leads ${fmtCount(last30?.leads)}, CPL ${fmtMoney(last30?.cplCents, currencyCode)}.
Leads this week: ${learningSummary}.
Days since launch: ${dsl ?? "not set"}.

Top 8 ads by CPL:
${ads.slice(0, 8).map((ad) => `- ${ad.adName ?? "Unnamed ad"} | spend ${fmtMoney(ad.spendCents, currencyCode)} | leads ${fmtCount(ad.leads)} | CPL ${fmtMoney(ad.cplCents, currencyCode)} | fatigue ${ad.fatigueScore != null ? (ad.fatigueScore * 100).toFixed(0) + "%" : "n/a"} | ${ad.status ?? "unknown"}`).join("\n")}

${fatiguedAds.length > 0 ? `Fatiguing creatives:\n${fatiguedAds.map((ad) => `- ${ad.adName}: ${ad.fatigueReason}`).join("\n")}\n` : ""}

UKTL conversion path (last 30d, paid Meta):
- Leads: ${fmtCount(funnel.leads)}
- Contacted: ${fmtCount(funnel.contacted)}
- Qualified: ${fmtCount(funnel.qualified)}
- Calls booked: ${fmtCount(funnel.callsBooked)}
- Calls attended: ${fmtCount(funnel.callsAttended)}
- Won customers: ${fmtCount(funnel.wonCustomers)}
- Lost: ${fmtCount(funnel.lostCustomers)}

${anomalies.length > 0 ? `Anomalies detected:\n${anomalies.map((anomaly) => `- ${anomaly.severity.toUpperCase()}: ${anomaly.message}`).join("\n")}\n` : ""}
`.trim();

  const prompt = `You are a paid acquisition analyst for UK Trade Leads, a UK trades lead-generation business.

Your job: produce a crisp daily briefing for the operator that they could read aloud in 30 seconds. Direct, no fluff, and honest when evidence is thin.

Style rules:
- Use UK Trade Leads terminology: leads, CPL, contacted, qualified, calls booked, calls attended, won customers, and lost.
- Use the supplied account currency and do not invent a target, budget, customer value, or attribution.
- If the learning lead target is not set, say it is not set. If a value is unavailable, say it is unavailable.
- Compare matched historical periods before claiming improvement or decline.
- Recommend ONE action max. Do not list five things.
- NEVER use em dashes.

OPERATING BRIEF:
${plan}

CURRENT METRICS:
${summary}

Return ONLY this JSON shape (no prose outside it):
{
  "headline": "1 sentence operator-facing headline. Conversational.",
  "yesterday_line": "1 sentence on yesterday: spend, leads, CPL.",
  "trend_line": "1 sentence comparing this week with matched history or configured targets.",
  "funnel_insight": "1 sentence calling out the largest evidenced conversion gap, or say downstream CRM data is unavailable.",
  "ads_to_watch": ["0-3 ad names worth watching - bombing or winning. Empty if evidence is too thin."],
  "recommended_action": "1 sentence with the single most important action today, or 'No action - stay the course' if the evidence says wait.",
  "on_track": "yes" or "no" or "too early",
  "on_track_reason": "1 sentence explaining the call."
}`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    cache = { key: cacheKey, text, at: Date.now() };
    return NextResponse.json({ summary: text, cached: false });
  } catch (err) {
    console.error("AI summary failed:", err instanceof Error ? err.name : "unknown error");
    return NextResponse.json({ summary: "AI summary unavailable; see server logs.", error: true });
  }
}
