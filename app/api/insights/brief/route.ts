import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { formatMoney } from "@/lib/format";
import { requireApiSession } from "@/lib/api-auth";
import { buildDashboardState } from "@/lib/read-model";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

type AdInput = { adName?: string; cplCents?: number | null; spendCents?: number | null; leads?: number | null; ctrLink?: number | null };

function fmtMoney(value: number | undefined | null, currencyCode: string | null | undefined) {
  return value == null ? "n/a" : formatMoney(value, currencyCode);
}

export async function POST(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
  }

  try {
    // Derive the evidence from the durable read model. Do not trust browser
    // supplied ad names, metrics, or currency when constructing an AI prompt.
    const state = await buildDashboardState();
    return await generateBrief(state, apiKey);
  } catch (error) {
    console.error("Creative brief data load failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "Creative brief unavailable; dashboard data could not be read." }, { status: 503 });
  }
}

async function generateBrief(state: Awaited<ReturnType<typeof buildDashboardState>>, apiKey: string) {
  const body = { currencyCode: state.meta.currencyCode };
  const ads = state.ads || [];
  const winners = ads.filter((ad) => ad.verdict === "winner" || ad.verdict === "performing").slice(0, 3);
  const losers = ads.filter((ad) => ad.verdict === "cull" || ad.verdict === "watch").slice(0, 3);
  const topAds: AdInput[] = (winners.length > 0 ? winners : ads.slice(0, 3)).map((ad) => ({
    adName: ad.adName,
    cplCents: ad.cplCents,
    spendCents: ad.spendCents,
    leads: ad.leads,
    ctrLink: ad.ctrLink,
  }));
  const losingAds: AdInput[] = losers.map((ad) => ({
    adName: ad.adName,
    cplCents: ad.cplCents,
    spendCents: ad.spendCents,
    leads: ad.leads,
    ctrLink: ad.ctrLink,
  }));

  if (topAds.length === 0) {
    return NextResponse.json({ error: "No leading ads yet to extract evidence from. Wait for more stored data." }, { status: 400 });
  }

  const winnerLines = topAds.map((ad) => `- ${ad.adName ?? "Unnamed ad"} | CPL ${fmtMoney(ad.cplCents, body.currencyCode)} | CTR ${ad.ctrLink != null ? (ad.ctrLink * 100).toFixed(2) + "%" : "n/a"} | spend ${fmtMoney(ad.spendCents, body.currencyCode)} | ${ad.leads == null ? "n/a" : ad.leads} leads`).join("\n");
  const loserLines = losingAds.map((ad) => `- ${ad.adName ?? "Unnamed ad"} | CPL ${fmtMoney(ad.cplCents, body.currencyCode)} | CTR ${ad.ctrLink != null ? (ad.ctrLink * 100).toFixed(2) + "%" : "n/a"} | spend ${fmtMoney(ad.spendCents, body.currencyCode)}`).join("\n");

  // Read the UKTL operating brief so the AI is grounded in the supplied context.
  const planContext = await import("@/lib/plan-context").then((module) => module.readPlan()).catch(() => "");

  const prompt = `You are a senior performance creative strategist for UK Trade Leads, a UK trades lead-generation business.

Campaign context (from the UKTL operating brief):
${planContext.slice(0, 2000)}

Your job: given the current leading and lagging ads below, propose 3 new creative angles to test next week. Extract why the leading ads may be working from the supplied evidence and design variants with genuinely different approaches. Do not claim lead quality from CPL alone.

LEADING ADS (lower CPL or stronger evidence):
${winnerLines}

${loserLines ? `LAGGING ADS (higher CPL or weaker engagement):\n${loserLines}\n` : ""}

Return ONLY this JSON shape:
{
  "winning_dna": "1-2 sentences extracting the pattern supported by the evidence - hook style, audience hint, format clue.",
  "new_angles": [
    {
      "name": "Concept name (3-5 words)",
      "hook": "First 3 seconds of script or visual. Exact words/visual.",
      "format": "Video / Static / Carousel / Reel",
      "script_outline": "30-second script in 3-4 lines.",
      "why_it_should_work": "1 sentence tying it back to the supplied evidence without inventing outcomes.",
      "novelty_axis": "What's different from current ads (visual style, hook angle, audience cut, format)"
    }
  ]
}

Rules:
- No em dashes anywhere.
- 3 angles total. Each must be genuinely novel, not a tiny tweak.
- Ground recommendations in the UKTL context and supplied ad evidence.
- Hooks must be conversational, not corporate.`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0]?.type === "text" ? response.content[0].text : "{}";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: "Model returned no JSON" }, { status: 502 });
    }
    return NextResponse.json(JSON.parse(match[0]));
  } catch (err) {
    console.error("Brief generation failed:", err instanceof Error ? err.name : "unknown error");
    return NextResponse.json({ error: "Brief generation failed; see server logs." }, { status: 500 });
  }
}
