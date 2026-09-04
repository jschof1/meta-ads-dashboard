"use client";

import { useEffect, useState, useCallback } from "react";
import type { DashboardState } from "@/lib/state-types";
import { AISummaryPanel } from "@/components/ai-summary-panel";
import { AnomalyBanner } from "@/components/anomaly-banner";
import { Scorecard } from "@/components/scorecard";
import { MetricHeroCards } from "@/components/metric-hero-cards";
import { CreativeLeaderboard } from "@/components/creative-leaderboard";
import { CreativeBriefGenerator } from "@/components/creative-brief-generator";
import { Funnel } from "@/components/funnel";
import { ActionLog } from "@/components/action-log";
import { PlanVisual } from "@/components/plan-visual";
import { AlertTriangle, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/format";

function SyncNotice({ state }: { state: DashboardState }) {
  const syncState = state.meta.syncState;
  if (syncState === "fresh") return null;
  const copy = {
    never: "No successful Meta sync yet. Performance metrics remain unavailable until the first sync completes.",
    running: "A Meta sync is running. The dashboard is continuing to show the last successful stored data.",
    stale: "Stored Meta data is stale. The dashboard is showing the last successful sync until a newer run completes.",
    failed: "The latest Meta sync failed. The dashboard is showing the last successful stored data.",
    fresh: "",
  }[syncState];
  const lastSuccess = state.meta.lastSuccessfulSyncAt
    ? new Date(state.meta.lastSuccessfulSyncAt).toLocaleString("en-GB", { timeZone: state.meta.timezoneName ?? "UTC" })
    : null;

  return (
    <section
      role="status"
      className={`mb-6 rounded-xl border px-4 py-3 text-sm ${syncState === "failed" ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"}`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${syncState === "failed" ? "text-destructive" : "text-amber-500"}`} />
        <div>
          <p className="font-medium">{syncState === "failed" ? "Meta sync failed" : syncState === "stale" ? "Stored data is stale" : syncState === "running" ? "Meta sync in progress" : "Awaiting first Meta sync"}</p>
          <p className="mt-1 text-foreground/80">{copy}</p>
          {lastSuccess && <p className="mt-1 text-xs text-muted-foreground">Last successful sync: {lastSuccess}</p>}
        </div>
      </div>
    </section>
  );
}

export default function DashboardHome() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/state", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || `${res.status}`);
        setState(null);
      } else {
        setState(json as DashboardState);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    function handler() {
      load();
    }
    window.addEventListener("ads-dashboard:refresh", handler);
    return () => window.removeEventListener("ads-dashboard:refresh", handler);
  }, [load]);

  if (loading && !state) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm">
        <div className="flex items-center gap-2 mb-2 text-destructive font-medium">
          <AlertTriangle className="w-4 h-4" /> Failed to load dashboard
        </div>
        <p className="text-foreground/80">{error}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Likely causes: META_MARKETING_TOKEN missing or expired, or Turso connection failing. Check Vercel env vars.
        </p>
      </div>
    );
  }

  if (!state) return null;

  return (
    <>
      <SyncNotice state={state} />
      <AISummaryPanel state={state} />
      <AnomalyBanner state={state} />
      <Scorecard state={state} />
      <MetricHeroCards state={state} />
      <Funnel state={state} />

      <section className="flex items-center justify-between mb-3 mt-2">
        <div>
          <h2 className="text-base font-semibold">Creative leaderboard</h2>
          <p className="text-xs text-muted-foreground">Sorted by CPL. Watch the fatigue column for diagnostic warnings.</p>
        </div>
        <CreativeBriefGenerator state={state} />
      </section>
      <CreativeLeaderboard state={state} />

      <ActionLog state={state} />
      <PlanVisual state={state} />

      <footer className="text-xs text-muted-foreground py-6">
        Last sync: {formatDateTime(state.meta.lastSyncAt, state.meta.timezoneName)} ·
        Campaign {state.meta.campaignId} · Account {state.meta.adAccountId}
      </footer>
    </>
  );
}
