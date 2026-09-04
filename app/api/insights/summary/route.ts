import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { readPlan } from "@/lib/plan-context";
import { requireApiSession } from "@/lib/api-auth";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Anomaly = { metric: string; direction: string; changePct: number; message: string; severity: string };
type DashboardState = {
  scorecard?: {
    today?: { spendCents?: number | null; registrations?: number | null; cprCents?: number | null };
    yesterday?: { spendCents?: number | null; registrations?: number | null; cprCents?: number | null };
    last7?: { spendCents?: number | null; registrations?: number | null; cprCents?: number | null; ctrLink?: number | null; cpmCents?: number | null; frequency?: number | null };
    last30?: { spendCents?: number | null; registrations?: number | null; cprCents?: number | null };
    eventsThisWeek?: number | null;
    learningEventsTarget?: number;
  };
  ads?: Array<{ adName?: string; cprCents?: number | null; spendCents?: number | null; status?: string; fatigueScore?: number | null; fatigueReason?: string | null }>;
  funnel?: { registrations?: number | null; attended?: number | null; callsBooked?: number | null; enrollments?: number | null };
  anomalies?: Anomaly[];
  meta?: { daysSinceLaunch?: number | null };
};

type CacheEntry = { key: string; text: string; at: number };
let cache: CacheEntry | null = null;
const TTL_MS = 60 * 60 * 1000;

function fmtMoney(cents: number | undefined | null) {
  if (cents == null) return "n/a";
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtCount(value: number | undefined | null): string {
  return value == null ? "n/a" : String(value);
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

  let state: DashboardState = {};
  try {
    state = (await request.json()) as DashboardState;
  } catch {
    state = {};
  }

  const cacheKey = `${dayKey()}::${JSON.stringify(state.scorecard || {})}::${JSON.stringify(state.funnel || {})}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ summary: cache.text, cached: true });
  }

  const plan = await readPlan();
  const today = state.scorecard?.today;
  const yest = state.scorecard?.yesterday;
  const last7 = state.scorecard?.last7;
  const last30 = state.scorecard?.last30;
  const ads = state.ads || [];
  const funnel = state.funnel || { registrations: null, attended: null, callsBooked: null, enrollments: null };
  const anomalies = state.anomalies || [];
  const dsl = state.meta?.daysSinceLaunch;

  const fatiguedAds = ads.filter((a) => a.fatigueScore != null && a.fatigueScore >= 0.5).slice(0, 5);

  const summary = `
Today: spend ${fmtMoney(today?.spendCents)}, regs ${fmtCount(today?.registrations)}, CPR ${fmtMoney(today?.cprCents)}.
Yesterday: spend ${fmtMoney(yest?.spendCents)}, regs ${fmtCount(yest?.registrations)}, CPR ${fmtMoney(yest?.cprCents)}.
Last 7d: spend ${fmtMoney(last7?.spendCents)}, regs ${fmtCount(last7?.registrations)}, CPR ${fmtMoney(last7?.cprCents)}, CTR ${last7?.ctrLink != null ? (last7.ctrLink * 100).toFixed(2) + "%" : "n/a"}, CPM ${fmtMoney(last7?.cpmCents)}, freq ${last7?.frequency?.toFixed(2) ?? "n/a"}.
Last 30d: spend ${fmtMoney(last30?.spendCents)}, regs ${fmtCount(last30?.registrations)}, CPR ${fmtMoney(last30?.cprCents)}.
Events this week: ${fmtCount(state.scorecard?.eventsThisWeek)} / ${state.scorecard?.learningEventsTarget ?? 50} (Meta learning-phase exit target).
Days since launch: ${dsl ?? "not yet active"}.

Top 8 ads by CPR:
${ads.slice(0, 8).map((a) => `- ${a.adName ?? "Unnamed ad"} | spend ${fmtMoney(a.spendCents)} | CPR ${fmtMoney(a.cprCents)} | fatigue ${a.fatigueScore != null ? (a.fatigueScore * 100).toFixed(0) + "%" : "n/a"} | ${a.status ?? "unknown"}`).join("\n")}

${fatiguedAds.length > 0 ? `Fatiguing creatives:\n${fatiguedAds.map((a) => `- ${a.adName}: ${a.fatigueReason}`).join("\n")}\n` : ""}

Full funnel (last 30d, paid Meta, deduped):
- Registrations: ${fmtCount(funnel.registrations)}
- Attended webinar: ${fmtCount(funnel.attended)}
- Calls booked: ${fmtCount(funnel.callsBooked)}
- Enrolled: ${fmtCount(funnel.enrollments)}

${anomalies.length > 0 ? `Anomalies detected:\n${anomalies.map((a) => `- ${a.severity.toUpperCase()}: ${a.message}`).join("\n")}\n` : ""}
`.trim();

  const prompt = `You are a paid acquisition analyst reading a Meta ad campaign.

Your job: produce a CRISP daily briefing for the operator that they could read aloud in 30 seconds. Direct, no fluff, no hedging unless signal really is too thin.

Style rules:
- Be conversational but tight. "Yesterday you spent $X and got Y regs at $Z CPR" not "the campaign generated".
- If learning phase (<50 events/week), explicitly call out that single-day numbers are noise.
- Recommend ONE action max. Don't list 5 things.
- NEVER use em dashes (use regular dashes or rewrite).

PLAN (target metrics + decision triggers):
${plan}

CURRENT METRICS:
${summary}

Return ONLY this JSON shape (no prose outside it):
{
  "headline": "1 sentence operator-facing headline. Conversational. E.g. 'CPR holding inside band, attendance is the leak.'",
  "yesterday_line": "1 sentence on yesterday: spend, regs, CPR.",
  "trend_line": "1 sentence comparing this week vs targets or vs last week.",
  "funnel_insight": "1 sentence calling out the biggest funnel leak (e.g. low attendance, low close rate). Use the deduped numbers.",
  "ads_to_watch": ["0-3 ad names worth watching - bombing or winning. Empty if too early."],
  "recommended_action": "1 sentence with the SINGLE most important action today, or 'No action - stay the course' if directional read says wait.",
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
