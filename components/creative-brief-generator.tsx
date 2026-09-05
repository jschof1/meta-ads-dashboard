"use client";

import { useEffect, useState } from "react";
import type { AiBriefingView, AiCreativeOutput } from "@/lib/ai-briefings";
import { Loader2, Sparkles, Wand2, Lightbulb, X } from "lucide-react";

type BriefResponse = {
  briefing: AiBriefingView | null;
  message?: string;
  error?: string;
};

function creativeOutput(briefing: AiBriefingView | null): AiCreativeOutput | null {
  if (!briefing || briefing.kind !== "creative" || !("angles" in briefing.output)) return null;
  return briefing.output;
}

export function CreativeBriefGenerator() {
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<AiBriefingView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/insights/brief", { cache: "no-store" })
      .then(async (response) => {
        const json = (await response.json()) as BriefResponse;
        if (!response.ok) throw new Error(json.error || `Creative brief read failed (${response.status})`);
        if (active) {
          setBriefing(json.briefing ?? null);
          setMessage(json.message || null);
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "Creative brief unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function generate() {
    setLoading(true);
    setOpen(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/insights/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = (await response.json()) as BriefResponse;
      if (!response.ok) throw new Error(json.error || `Creative brief failed (${response.status})`);
      setBriefing(json.briefing ?? null);
      setMessage(json.message || null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Creative brief unavailable");
    } finally {
      setLoading(false);
    }
  }

  const output = creativeOutput(briefing);
  function openOrGenerate() {
    setOpen(true);
    if (!briefing) void generate();
  }

  return (
    <>
      <button
        onClick={openOrGenerate}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
        {briefing ? "View creative brief" : "Generate next creative brief"}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto" onClick={() => setOpen(false)}>
          <div
            className="bg-card border border-border rounded-2xl shadow-2xl max-w-3xl w-full my-auto"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-semibold">Next creative brief</h2>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={generate} disabled={loading} className="text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 disabled:opacity-60">
                  Regenerate
                </button>
                <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close creative brief">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {loading && (
                <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Anthropic is using stored copy, performance and media metadata to propose three hypotheses...
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              {message && !error && !output && !loading && <p className="text-sm text-muted-foreground">{message}</p>}

              {output && (
                <div className="space-y-5">
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-4 text-sm">
                    <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-semibold mb-1.5">Evidence boundary</div>
                    <p className="leading-relaxed">{output.mediaDisclosure}</p>
                  </div>

                  <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4">
                    <div className="flex items-center gap-2 text-emerald-500 text-xs uppercase tracking-wide font-semibold mb-1.5">
                      <Lightbulb className="w-4 h-4" />
                      Winning pattern hypothesis
                    </div>
                    <p className="text-sm leading-relaxed">{output.winningDna.text}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Evidence: {output.winningDna.evidenceIds.join(" · ")}</p>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">3 new angles to test</h3>
                    {output.angles.map((angle, index) => (
                      <div key={`${angle.name}-${index}`} className="rounded-xl border border-border bg-muted/30 p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="text-xs text-muted-foreground">Concept {index + 1}</div>
                            <h4 className="text-base font-semibold">{angle.name}</h4>
                          </div>
                          <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">{angle.format}</span>
                        </div>

                        <div className="space-y-2 text-sm">
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Hook</div>
                            <p className="font-medium italic">&ldquo;{angle.hook}&rdquo;</p>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Script outline</div>
                            <p className="text-foreground/80 leading-relaxed whitespace-pre-line">{angle.scriptOutline}</p>
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3 pt-2 border-t border-border">
                            <div>
                              <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Why it might work</div>
                              <p className="text-xs text-foreground/70">{angle.whyItShouldWork.text}</p>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">Novelty axis</div>
                              <p className="text-xs text-foreground/70">{angle.noveltyAxis}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-muted-foreground">Evidence: {angle.evidenceIds.join(" · ")}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {briefing?.stale && <p className="text-xs text-amber-600 dark:text-amber-400">This brief is older than the current stored data. Regenerate it before relying on the hypotheses.</p>}
                  <p className="text-[10px] text-muted-foreground border-t border-border pt-2">Generated {new Date(briefing?.generatedAt ?? "").toLocaleString("en-GB")} · provider: {briefing?.provider} · model: {briefing?.model}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
