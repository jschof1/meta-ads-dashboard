"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, ChevronDown } from "lucide-react";
import { formatMoney, formatCount, formatPercent, formatDateTime } from "@/lib/format";
import { monthlyCsv, type MonthlyReport, type MonthlyEntity } from "@/lib/monthly-performance";

const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
function Change({ label, value }: { label: string; value: number | null }) {
  return <span className="rounded-md bg-muted px-3 py-2 text-sm">{label} <strong>{value == null ? "unavailable" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`}</strong></span>;
}
export function MonthlyPerformancePanel() {
  const [report, setReport] = useState<MonthlyReport | null>(null), [error, setError] = useState(false), [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null), [level, setLevel] = useState<"campaigns" | "ads">("ads");
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch("/api/dashboard/monthly", { signal, cache: "no-store" });
      if (!response.ok) throw new Error("unavailable");
      const result = await response.json() as MonthlyReport;
      if (!signal?.aborted) { setReport(result); setError(false); }
    } catch { if (!signal?.aborted) setError(true); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Initial state already says loading; defer the initial fetch out of the synchronous effect.
    queueMicrotask(() => { if (!controller.signal.aborted) void load(controller.signal); });
    const refresh = () => { void load(controller.signal); };
    window.addEventListener("ads-dashboard:refresh", refresh); window.addEventListener("lead-register:updated", refresh);
    return () => { controller.abort(); window.removeEventListener("ads-dashboard:refresh", refresh); window.removeEventListener("lead-register:updated", refresh); };
  }, [load]);
  const active = report?.months.find(m => m.month === selected) ?? report?.months[0];
  const money = (value: number | null) => formatMoney(value, report?.currency ?? "GBP");
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob(["\uFEFF", monthlyCsv(report)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `uktl-monthly-performance-${report.generatedAt.slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const ranked: MonthlyEntity[] = active?.[level] ?? [];
  const chartMonths = report?.months.filter(m => m.metrics.cpl != null).slice().reverse() ?? [];
  const maxCpl = Math.max(1, ...chartMonths.map(m => m.metrics.cpl ?? 0));
  return <section id="monthly-performance" className="mb-6 rounded-xl border p-4 sm:p-5" aria-labelledby="monthly-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="monthly-title" className="text-lg font-semibold">Month-by-month performance</h2><p className="mt-1 max-w-3xl text-sm text-muted-foreground">See how spend, Meta results and real enquiries change over time. Select a month to review the ads behind it.</p></div><div className="flex gap-3"><button disabled={loading} onClick={() => void load()} className="text-sm underline disabled:opacity-50">{loading ? "Reading…" : "Refresh saved data"}</button><button disabled={!report?.months.length} onClick={download} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"><Download className="h-4 w-4" />Export CSV</button></div></div>
    {error && <p role="alert" className="mt-3 text-sm">Monthly data could not refresh. {report ? "The previous saved report remains below; check its timestamps." : "Retry using Refresh saved data."}</p>}
    {report && <><p className="mt-3 text-xs text-muted-foreground">{report.scope} · {report.currency} · {report.timezone} · Meta attribution: {report.attribution.replaceAll("_", " ")} · up to 12 months of saved history</p>
      {chartMonths.length > 1 && <figure className="mt-4 rounded-lg bg-muted/25 p-3"><figcaption className="text-sm font-medium">Cost per Meta lead by month</figcaption><p className="mt-1 text-xs text-muted-foreground">Lower costs mean less spend per recorded Lead event. Partial months are labelled; this does not measure lead quality or sales.</p><div className="mt-3 overflow-x-auto"><ul className="flex min-w-fit gap-4" aria-label="Monthly cost per lead trend">{chartMonths.map(m => <li key={m.month} className="w-24 shrink-0 text-center"><span className="text-sm font-semibold tabular-nums">{money(m.metrics.cpl)}</span><div className="mt-1 flex h-20 items-end justify-center" aria-hidden="true"><div className={`w-10 rounded-t bg-primary/65 ${m.current || m.coverage !== "complete" ? "border-2 border-dashed border-foreground/50 bg-primary/25" : ""}`} style={{ height: `${Math.max(2, (m.metrics.cpl ?? 0) / maxCpl * 100)}%` }} /></div><span className="mt-1 block text-xs">{monthName(m.month)}</span><span className="block text-xs text-muted-foreground">{m.current ? "Month to date" : m.coverage === "complete" ? "Full month" : "Partial"}</span></li>)}</ul></div></figure>}
      <div className="mt-4 overflow-x-auto rounded-lg border" tabIndex={0} aria-label="Monthly performance table, scroll for all columns"><table className="w-full whitespace-nowrap text-left text-sm"><caption className="sr-only">Calendar-month spend, Meta leads and saved HighLevel outcomes. Partial coverage is labelled.</caption><thead className="bg-muted/50"><tr>{["Month / coverage", "Spend", "Meta leads", "CPL", "Form people¹", "Receipts¹", "Booked people¹", "Appointments¹", "Link clicks", "Link CTR", "Link CPC", "CPM", "Impressions"].map(h => <th key={h} scope="col" className="px-3 py-3 font-medium">{h}</th>)}</tr></thead><tbody>{report.months.map(m => <tr key={m.month} className={`border-t ${active?.month === m.month ? "bg-primary/5" : ""}`}><th scope="row" className="px-3 py-3 font-normal"><button aria-pressed={active?.month === m.month} onClick={() => setSelected(m.month)} className="text-left"><span className="font-semibold underline decoration-dotted underline-offset-4">{monthName(m.month)}</span><span className="mt-1 block text-xs text-muted-foreground">{m.current ? "Month to date · " : ""}{m.coverage === "complete" ? `${m.days} days saved` : `${m.coverage} · ${m.days}/${m.expectedDays} days`}</span></button></th>{[money(m.metrics.spend), formatCount(m.metrics.leads), money(m.metrics.cpl), formatCount(m.outcomes?.peopleEnquiring ?? null), formatCount(m.outcomes?.receipts ?? null), formatCount(m.outcomes?.bookers ?? null), formatCount(m.outcomes?.appointments ?? null), formatCount(m.metrics.linkClicks), formatPercent(m.metrics.ctr), money(m.metrics.linkCpc), money(m.metrics.cpm), formatCount(m.metrics.impressions)].map((v, i) => <td key={i} className="px-3 py-3 tabular-nums">{v}{i === 3 && m.outcomeCoverage === "partial" && <span className="ml-1 text-xs text-muted-foreground">so far</span>}</td>)}</tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-muted-foreground">Scroll across for enquiries, bookings and click costs. Select a month name for its breakdown. Records marked test in the saved register are excluded.</p>
      {!report.months.length && <p className="mt-4 text-sm">No successful saved Meta history is available yet.</p>}
      <p className="mt-2 text-xs text-muted-foreground">¹ HighLevel outcomes cover the whole UKTL register across all sources. They are not attributed sales from these ads. A dash means unavailable, not zero. Partial Meta totals include only saved days; today is still in progress. Older unknown lead values are recalculated from valid saved Meta action receipts only when the configured result event matches.</p>
      {active && <div className="mt-5 rounded-lg bg-muted/25 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{monthName(active.month)} in detail</h3><label className="inline-flex items-center gap-2 text-sm">Show <select value={level} onChange={e => setLevel(e.target.value as "ads" | "campaigns")} className="rounded-md border bg-background px-2 py-1"><option value="ads">Ads</option><option value="campaigns">Campaigns</option></select><ChevronDown aria-hidden className="h-3 w-3" /></label></div>
        {active.comparison ? <><p className="mt-2 text-xs text-muted-foreground">{active.comparison.label}</p><div className="mt-2 flex flex-wrap gap-2"><Change label="Spend" value={active.comparison.spendChange} /><Change label="Meta leads" value={active.comparison.leadChange} /><Change label="CPL" value={active.comparison.cplChange} /></div></> : <p className="mt-2 text-sm text-muted-foreground">No fair prior-month comparison: complete saved days are required for both periods.</p>}
        {active.outcomes ? <p className="mt-3 text-sm">HighLevel: <strong>{active.outcomes.contacts}</strong> new contact records (can include imports), including <strong>{active.outcomes.metaSourcedContacts}</strong> with a Facebook/Instagram source. Calendar: {active.outcomes.confirmed} confirmed, {active.outcomes.cancelled} cancelled, {active.outcomes.noShows} explicit no shows. {active.outcomeCoverage === "partial" ? "This month is still accumulating." : "Calendar-month coverage is complete."}</p> : <p className="mt-3 text-sm text-muted-foreground">HighLevel history does not cover this full month. Enquiries and bookings are unavailable for a complete comparison.</p>}
        <p className="mt-2 text-xs text-muted-foreground">Appointments use their scheduled date and exclude cancelled events from the headline count. Confirmation does not prove attendance. Repeat receipts count separately; form people and booked people are deduplicated within each month.</p>
        <div className="mt-3 overflow-x-auto" tabIndex={0} aria-label="Selected month ad breakdown"><table className="w-full text-left text-sm"><thead><tr>{[level === "ads" ? "Ad" : "Campaign", "Spend", "Spend share", "Meta leads", "CPL", "Link CTR"].map(h => <th key={h} scope="col" className="px-2 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead><tbody>{ranked.map(r => <tr className="border-t" key={r.id}><th scope="row" className="min-w-48 max-w-md px-2 py-2 font-normal">{r.name}</th><td className="px-2 py-2 whitespace-nowrap">{money(r.spend)}</td><td className="px-2 py-2">{formatPercent(r.spendShare)}</td><td className="px-2 py-2">{formatCount(r.leads)}</td><td className="px-2 py-2 whitespace-nowrap">{money(r.cpl)}</td><td className="px-2 py-2">{formatPercent(r.ctr)}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-muted-foreground">Sorted by spend. Names reflect the latest saved metadata. Meta Lead events may include repeat actions by the same person. CPL is undefined when there are no leads; link CPC uses link clicks. Monthly unique reach, revenue and ROAS are not inferred.</p>
      </div>}
      <p className="mt-4 text-xs text-muted-foreground">Meta saved: {formatDateTime(report.metaCheckedAt, report.timezone)} · HighLevel saved: {formatDateTime(report.crmCheckedAt, report.timezone)}{report.crmCoverageStart && ` · HighLevel history starts ${formatDateTime(report.crmCoverageStart, report.timezone)}`}. Refresh reads saved data only and uses no HighLevel quota.</p>
    </>}
  </section>;
}
