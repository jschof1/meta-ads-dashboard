"use client";

import { useEffect, useState } from "react";
import { Activity, Bot, Database, GitBranch, Layers3, RefreshCw, ShieldCheck } from "lucide-react";
import type { SystemDiagnostics, DiagnosticStatus } from "@/lib/system-diagnostics";

function statusLabel(status: DiagnosticStatus | SystemDiagnostics["migrations"]["status"]): string {
  return status.replaceAll("_", " ");
}

function statusClass(status: DiagnosticStatus | SystemDiagnostics["migrations"]["status"]): string {
  if (status === "ok") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  if (status === "failed" || status === "misconfigured") return "border-destructive/30 bg-destructive/10 text-destructive";
  if (status === "stale" || status === "warning") return "border-amber-500/30 bg-amber-500/10 text-amber-500";
  return "border-border bg-muted/40 text-muted-foreground";
}

function SyncValue({ sync }: { sync: SystemDiagnostics["database"]["sync"] }) {
  if (sync.status === "unknown") return <span>unknown</span>;
  if (sync.status === "not_configured") return <span>not configured</span>;
  return <span>{statusLabel(sync.status)}{sync.lastSuccessfulSyncAt ? ` · ${new Date(sync.lastSuccessfulSyncAt).toLocaleString("en-GB")}` : ""}</span>;
}

function DiagnosticCard({
  icon: Icon,
  label,
  status,
  children,
}: {
  icon: typeof Activity;
  label: string;
  status: DiagnosticStatus | SystemDiagnostics["migrations"]["status"];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-primary" />{label}</div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] capitalize ${statusClass(status)}`}>{statusLabel(status)}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

export function SystemDiagnosticsPanel() {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/diagnostics", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { error?: string } | SystemDiagnostics | null;
        if (!response.ok) throw new Error(body && "error" in body && body.error ? body.error : `Diagnostics failed (${response.status})`);
        if (active) setDiagnostics(body as SystemDiagnostics);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Diagnostics could not be loaded");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <section aria-label="System diagnostics" className="mb-6 rounded-xl border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Operations</p>
          <h2 className="mt-1 text-base font-semibold">System diagnostics</h2>
        </div>
        {diagnostics && <p className="text-xs text-muted-foreground">Checked {new Date(diagnostics.checkedAt).toLocaleString("en-GB")}</p>}
      </div>
      {loading && <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Checking stored health and configuration…</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      {diagnostics && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <DiagnosticCard icon={Database} label="Database" status={diagnostics.database.status}>
            {diagnostics.database.status === "ok" ? `Reachable${diagnostics.database.latencyMs != null ? ` in ${diagnostics.database.latencyMs}ms` : ""}. ` : diagnostics.database.configuration === "misconfigured" ? "Configuration is not safe for this environment. " : "Unavailable. "}
            Sync: <SyncValue sync={diagnostics.database.sync} />
          </DiagnosticCard>
          <DiagnosticCard icon={Activity} label="Meta read" status={diagnostics.meta.status}>
            {diagnostics.meta.configuration === "configured" ? "Server credentials present. " : "Credentials not configured. "}
            Sync: <SyncValue sync={diagnostics.meta.sync} />
          </DiagnosticCard>
          <DiagnosticCard icon={ShieldCheck} label="Meta actions" status={diagnostics.meta.actionGate.status === "ready" ? "ok" : diagnostics.meta.actionGate.status === "disabled" ? "disabled" : "misconfigured"}>
            {diagnostics.meta.actionGate.message}
          </DiagnosticCard>
          <DiagnosticCard icon={Bot} label="AI" status={diagnostics.ai.status}>
            {diagnostics.ai.configuration === "configured" ? "Provider key present. " : "Optional provider not configured. "}
            {diagnostics.ai.lastGeneratedAt ? `Last snapshot ${new Date(diagnostics.ai.lastGeneratedAt).toLocaleString("en-GB")}.` : "No stored snapshot."}
          </DiagnosticCard>
          <DiagnosticCard icon={Layers3} label="HighLevel" status={diagnostics.highLevel.status}>
            {diagnostics.highLevel.configuration.replaceAll("_", " ")}. Sync: <SyncValue sync={diagnostics.highLevel.sync} />
          </DiagnosticCard>
          <DiagnosticCard icon={GitBranch} label="Migrations" status={diagnostics.migrations.status}>
            {diagnostics.migrations.latestApplied ? `Latest ${diagnostics.migrations.latestApplied}.` : "No applied migration recorded."}
            {diagnostics.migrations.failedCount ? ` ${diagnostics.migrations.failedCount} failed or incomplete.` : ""}
          </DiagnosticCard>
        </div>
      )}
    </section>
  );
}
