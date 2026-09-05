"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Loader2, Volume2, RotateCw } from "lucide-react";
import type { AiBriefingView, AiSummaryOutput } from "@/lib/ai-briefings";
import type { DashboardState } from "@/lib/state-types";

type SummaryResponse = {
  briefing: AiBriefingView | null;
  enabled?: boolean;
  message?: string;
};

function summaryOutput(briefing: AiBriefingView | null): AiSummaryOutput | null {
  if (!briefing || briefing.kind !== "summary" || !("headline" in briefing.output)) return null;
  return briefing.output;
}

function speak(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.05;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

function ClaimList({
  title,
  claims,
  evidence,
}: {
  title: string;
  claims: AiSummaryOutput["changes"];
  evidence: AiBriefingView["evidence"];
}) {
  if (claims.length === 0) return null;
  const labels = new Map(evidence.map((item) => [item.id, item.label]));
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{title}</div>
      {claims.map((claim, index) => (
        <div key={`${claim.text}-${index}`} className="text-sm leading-relaxed">
          <p>{claim.text}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Evidence: {claim.evidenceIds.map((id) => labels.get(id) ?? id).join(" · ")}</p>
        </div>
      ))}
    </div>
  );
}

export function AISummaryPanel({ state }: { state: DashboardState | null }) {
  const [briefing, setBriefing] = useState<AiBriefingView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadStored = useCallback(async () => {
    if (!state) return;
    setLoading(true);
    setErr(null);
    try {
      const response = await fetch("/api/insights/summary", { cache: "no-store" });
      const json = (await response.json()) as SummaryResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || `Summary read failed (${response.status})`);
      setBriefing(json.briefing ?? null);
      setMessage(json.message || null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "AI summary unavailable");
    } finally {
      setLoading(false);
    }
  }, [state]);

  async function regenerate() {
    if (!state) return;
    setLoading(true);
    setErr(null);
    try {
      const response = await fetch("/api/insights/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await response.json()) as SummaryResponse & { error?: string };
      if (!response.ok) throw new Error(json.error || `Summary generation failed (${response.status})`);
      setBriefing(json.briefing ?? null);
      setMessage(json.message || null);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "AI summary unavailable");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // The effect starts an external read; its state updates happen when the
    // fetch resolves rather than as part of rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadStored();
  }, [loadStored]);

  const output = summaryOutput(briefing);
  const fullSpoken = output
    ? [output.headline.text, ...output.changes.map((claim) => claim.text), output.mainRecommendation?.text]
      .filter(Boolean)
      .join(" ")
    : "";
  const evidenceLabels = briefing?.evidence ?? [];

  return (
    <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-6 mb-6 relative overflow-hidden">
      <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-primary/10 blur-3xl pointer-events-none" />

      <div className="flex items-center justify-between mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">AI Daily Briefing</div>
            <div className="text-[10px] text-muted-foreground">Persisted, evidence-grounded explanation</div>
          </div>
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin ml-2 text-primary" />}
        </div>

        <div className="flex items-center gap-1.5">
          {output && fullSpoken && (
            <button
              onClick={() => speak(fullSpoken)}
              className="text-xs px-2.5 py-1.5 rounded-md border border-border bg-card hover:bg-muted/60 flex items-center gap-1.5 transition-colors"
              title="Read briefing aloud"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Listen
            </button>
          )}
          <button
            onClick={regenerate}
            className="text-xs p-1.5 rounded-md border border-border bg-card hover:bg-muted/60 transition-colors"
            title="Regenerate briefing"
            disabled={loading || !state}
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {err && <p className="text-sm text-destructive relative">{err}</p>}
      {message && !err && <p className="text-sm text-muted-foreground relative">{message}</p>}

      {output && (
        <div className="space-y-4 relative mt-4">
          <div>
            <h2 className="text-xl font-semibold leading-snug">{output.headline.text}</h2>
            <p className="text-[10px] text-muted-foreground mt-1">Evidence: {output.headline.evidenceIds.map((id) => evidenceLabels.find((item) => item.id === id)?.label ?? id).join(" · ")}</p>
          </div>
          <ClaimList title="Changes" claims={output.changes} evidence={evidenceLabels} />
          <ClaimList title="Known" claims={output.known} evidence={evidenceLabels} />
          <ClaimList title="Uncertain" claims={output.uncertain} evidence={evidenceLabels} />
          <ClaimList title="Possible causes (hypotheses)" claims={output.possibleCauses} evidence={evidenceLabels} />
          <ClaimList title="What to watch" claims={output.whatToWatch} evidence={evidenceLabels} />

          <div className="rounded-xl bg-primary/10 border border-primary/30 p-4">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-1 font-semibold">Main recommendation</div>
            <p className="text-sm font-medium">{output.mainRecommendation?.text || "No action supported by the supplied evidence."}</p>
            {output.mainRecommendation && <p className="text-[10px] text-muted-foreground mt-1">Operator approval is required. Evidence: {output.mainRecommendation.evidenceIds.join(" · ")}</p>}
          </div>

          {briefing?.stale && <p className="text-xs text-amber-600 dark:text-amber-400">This briefing is older than the current stored data. Regenerate it before relying on the explanation.</p>}
          <p className="text-[10px] text-muted-foreground border-t border-border pt-2">Generated {new Date(briefing?.generatedAt ?? "").toLocaleString("en-GB")} · provider: {briefing?.provider} · model: {briefing?.model}</p>
        </div>
      )}

      {!loading && !output && !err && !message && (
        <p className="text-sm text-muted-foreground relative">No persisted AI briefing yet. Generate one after the campaign goes live.</p>
      )}
    </section>
  );
}
