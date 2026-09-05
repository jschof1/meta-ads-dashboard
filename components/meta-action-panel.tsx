"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Play, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, currencyMinorUnitScale } from "@/lib/format";
import type { MetaActionView } from "@/lib/meta-action-types";
import type { DashboardState } from "@/lib/state-types";

function actionTitle(action: MetaActionView["action"]): string {
  if (action === "pause_ad") return "Pause ad";
  if (action === "resume_ad") return "Resume ad";
  return "Set ad-set daily budget";
}

function statusStyle(status: MetaActionView["status"]): string {
  if (status === "EXECUTED") return "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300";
  if (status === "FAILED" || status === "REJECTED") return "border-destructive/30 bg-destructive/5 text-destructive";
  if (status === "APPROVED" || status === "EXECUTING") return "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300";
  return "border-border bg-muted/30 text-muted-foreground";
}

function statusLabel(status: MetaActionView["status"]): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function exactChange(action: MetaActionView, currencyCode: string | null): string {
  if ("status" in action.requestedChange) {
    return `${actionTitle(action.action)}: ${action.expectedState.status} → ${action.requestedChange.status}`;
  }
  return `${actionTitle(action.action)}: ${formatMoney(action.expectedState.dailyBudgetMinor, currencyCode)} → ${formatMoney(action.requestedChange.dailyBudgetMinor, currencyCode)}`;
}

function evidenceLine(evidence: MetaActionView["evidence"], currencyCode: string | null): string {
  const current = evidence.current;
  return `Evidence: ${formatMoney(current.spendCents, currencyCode)} spend, ${current.leads == null ? "unknown" : current.leads} leads, ${formatMoney(current.cplCents, currencyCode)} CPL over the matched ${evidence.comparisonDays}d window.`;
}

function recommendationAction(recommendation: DashboardState["recommendations"][number], state: DashboardState): MetaActionView["action"] | null {
  if (recommendation.type === "pause_candidate" && recommendation.target.type === "ad") return "pause_ad";
  if (recommendation.type === "scale_candidate" && recommendation.target.type === "adset") return "set_adset_daily_budget";
  if (recommendation.type === "hold" && recommendation.target.type === "ad") {
    const ad = state.ads.find((item) => item.adId === recommendation.target.id);
    if (ad?.status === "PAUSED") return "resume_ad";
  }
  return null;
}

function budgetInputToMinor(value: string, currencyCode: string | null): number | null {
  const scale = currencyMinorUnitScale(currencyCode);
  const major = Number(value);
  if (scale == null || !Number.isFinite(major) || major <= 0) return null;
  const minor = Math.round(major * scale);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

async function postAction(path: string, body?: unknown): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : "The action could not be completed");
}

function ActionRecord({ action, state, busy, onAction }: { action: MetaActionView; state: DashboardState; busy: string | null; onAction: (key: string, work: () => Promise<void>) => void }) {
  const keyPrefix = `action-${action.id}`;
  const isBusy = busy === keyPrefix;
  return (
    <article className="rounded-xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{actionTitle(action.action)}</p>
          <p className="text-xs text-muted-foreground">{action.targetName} · <code>{action.targetId}</code></p>
        </div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusStyle(action.status)}`}>{statusLabel(action.status)}</span>
      </div>
      <p className="mt-3 text-sm font-medium">{exactChange(action, state.meta.currencyCode)}</p>
      <p className="mt-1 text-xs leading-relaxed text-foreground/80">{action.reasoning}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">{action.confidence} confidence · {evidenceLine(action.evidence, state.meta.currencyCode)}</p>
      {action.error && <p className="mt-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-xs text-destructive">{action.error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {action.status === "PROPOSED" && (
          <>
            <Button type="button" size="sm" onClick={() => onAction(`${keyPrefix}-approve`, () => postAction(`/api/actions/${action.id}/approve`))} disabled={busy != null}>
              <ShieldCheck /> Approve
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onAction(`${keyPrefix}-reject`, () => postAction(`/api/actions/${action.id}/reject`))} disabled={busy != null}>
              <XCircle /> Reject
            </Button>
          </>
        )}
        {action.status === "APPROVED" && (
          <Button type="button" size="sm" onClick={() => onAction(keyPrefix, () => postAction(`/api/actions/${action.id}/execute`))} disabled={busy != null || !state.meta.actionGate.writesEnabled}>
            <Play /> {isBusy ? "Executing…" : "Execute approved change"}
          </Button>
        )}
        {action.status === "EXECUTING" && <span className="text-xs text-muted-foreground">Execution is claimed. It will not be retried automatically.</span>}
        {action.status === "FAILED" && <span className="text-xs text-muted-foreground">Prepare a fresh recommendation-bound action after checking Meta.</span>}
      </div>
    </article>
  );
}

export function MetaActionPanel({ state }: { state: DashboardState }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const actions = state.metaActions ?? [];
  const actionByRecommendation = new Map(actions
    .filter((action) => action.recommendationFingerprint && action.sourceSyncRunId)
    .map((action) => [`${action.recommendationFingerprint}|${action.sourceSyncRunId}`, action]));

  async function run(key: string, work: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await work();
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The action could not be completed");
    } finally {
      setBusy(null);
    }
  }

  const eligible = state.recommendations.filter((recommendation) => recommendationAction(recommendation, state) != null);
  return (
    <section id="meta-actions" aria-labelledby="meta-actions-title" className="mb-6 rounded-2xl border border-amber-500/20 bg-card p-5">
      <div className="mb-4 flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <h2 id="meta-actions-title" className="text-base font-semibold">Approval-gated Meta actions</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Recommendations never call Meta. Prepare the exact change, approve it, then execute it as a separate server request.</p>
        </div>
      </div>

      <div className={`mb-4 rounded-lg border p-3 text-xs ${state.meta.actionGate.status === "ready" ? "border-emerald-500/25 bg-emerald-500/5" : "border-amber-500/25 bg-amber-500/5"}`} role="status">
        <p className="font-medium">{state.meta.actionGate.status === "ready" ? "Server write gate is enabled" : state.meta.actionGate.status === "misconfigured" ? "Server write gate is misconfigured" : "Server write gate is disabled"}</p>
        <p className="mt-1 text-muted-foreground">{state.meta.actionGate.message}</p>
      </div>

      {error && <div className="mb-4 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive" role="alert">{error}</div>}

      {actions.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Recorded proposals and executions</div>
          {actions.map((action) => <ActionRecord key={action.id} action={action} state={state} busy={busy} onAction={run} />)}
        </div>
      )}

      {eligible.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><RotateCcw className="h-3.5 w-3.5" /> Prepare from stored recommendations</div>
          {eligible.map((recommendation) => {
            const action = recommendationAction(recommendation, state) as MetaActionView["action"];
            const existing = recommendation.sourceSyncRunId
              ? actionByRecommendation.get(`${recommendation.fingerprint}|${recommendation.sourceSyncRunId}`)
              : undefined;
            if (existing) return null;
            const budgetValue = budgets[recommendation.fingerprint] ?? "";
            const dailyBudgetMinor = action === "set_adset_daily_budget" ? budgetInputToMinor(budgetValue, state.meta.currencyCode) : null;
            const targetBudget = state.adSets.find((item) => item.adSetId === recommendation.target.id)?.dailyBudgetMinor ?? null;
            return (
              <article key={recommendation.fingerprint} className="rounded-xl border border-border bg-background/60 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{actionTitle(action)} · {recommendation.target.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-foreground/85">{recommendation.reason}</p>
                    <p className="mt-2 text-xs font-medium">Evidence and confidence: {recommendation.confidence} · {evidenceLine(recommendation.evidence, state.meta.currencyCode)}</p>
                    {action === "set_adset_daily_budget" && (
                      <div className="mt-3 max-w-xs">
                        <label className="mb-1 block text-xs font-medium" htmlFor={`budget-${recommendation.fingerprint}`}>New daily budget ({state.meta.currencyCode ?? "account currency"})</label>
                        <Input
                          id={`budget-${recommendation.fingerprint}`}
                          inputMode="decimal"
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder={targetBudget == null ? "Current budget unknown" : formatMoney(targetBudget, state.meta.currencyCode)}
                          value={budgetValue}
                          onChange={(event) => setBudgets((current) => ({ ...current, [recommendation.fingerprint]: event.target.value }))}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground">The server applies the configured absolute and percentage safety bounds.</p>
                      </div>
                    )}
                    <div className="mt-3">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy != null || (action === "set_adset_daily_budget" && dailyBudgetMinor == null)}
                        onClick={() => run(`prepare-${recommendation.fingerprint}`, () => postAction("/api/actions", {
                          recommendationFingerprint: recommendation.fingerprint,
                          action,
                          ...(action === "set_adset_daily_budget" ? { dailyBudgetMinor } : {}),
                        }))}
                      >
                        <ShieldCheck /> Prepare approval
                      </Button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {actions.length === 0 && eligible.length === 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No recommendation-bound Meta action is currently available. Unsupported recommendations and AI output have no mutation path.
        </div>
      )}
    </section>
  );
}
