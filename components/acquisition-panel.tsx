"use client";

import { useEffect, useState } from "react";
import type { AcquisitionQuery, AcquisitionReport, CustomerCohort } from "@/lib/acquisition-report";
import { accountLocalDate, addCalendarDays } from "@/lib/periods";
import { formatMoney } from "@/lib/format";
import { Loader2 } from "lucide-react";

const money = (v: number | null | undefined) => formatMoney(v == null ? null : Math.round(v), "GBP");
const count = (v: number | null | undefined) => v == null ? "Not verified" : v.toLocaleString("en-GB");
const percent = (v: number | null | undefined) => v == null ? "—" : `${(v * 100).toFixed(2)}%`;
const delta = (v: number | null) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const control = "min-h-10 rounded-md border bg-background px-3 text-sm max-w-full";
const th = "px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap";
const td = "px-3 py-3 text-sm tabular-nums whitespace-nowrap";
function initial(): AcquisitionQuery {
  const until = addCalendarDays(accountLocalDate(new Date(), "Europe/London"), -1), since = addCalendarDays(until, -29);
  return { since, until, compareUntil: addCalendarDays(since, -1), compareSince: addCalendarDays(since, -30), grain: "month", level: "ad", touch: "first" };
}
function retention(c: CustomerCohort, days: 30 | 90) {
  const eligible = days === 30 ? c.eligible30 : c.eligible90, retained = days === 30 ? c.retained30 : c.retained90;
  return eligible < 10 ? `${retained}/${eligible} · insufficient evidence` : `${percent(retained / eligible)} (${retained}/${eligible})`;
}

export function AcquisitionPanel() {
  const [query, setQuery] = useState<AcquisitionQuery>(initial);
  const [applied, setApplied] = useState<AcquisitionQuery>(initial);
  const [report, setReport] = useState<AcquisitionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/acquisition?${new URLSearchParams(applied)}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load acquisition reporting");
      setReport(data); setError(null);
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load acquisition reporting"); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [applied, reload]);
  useEffect(() => {
    const refresh = () => { setBusy(true); setReload(n => n + 1); };
    window.addEventListener("ads-dashboard:refresh", refresh);
    return () => window.removeEventListener("ads-dashboard:refresh", refresh);
  }, []);
  function rolling(days: number) {
    const until = addCalendarDays(accountLocalDate(new Date(), "Europe/London"), -1), since = addCalendarDays(until, -(days - 1));
    setQuery(q => ({ ...q, since, until, compareSince: addCalendarDays(since, -days), compareUntil: addCalendarDays(since, -1) }));
  }
  function february() {
    const today = accountLocalDate(new Date(), "Europe/London"), until = addCalendarDays(`${today.slice(0, 8)}01`, -1);
    setQuery(q => ({ ...q, since: `${until.slice(0, 8)}01`, until, compareSince: "2026-02-01", compareUntil: "2026-02-28" }));
  }
  const selectedRow = report?.rows.find(r => r.entityId === selected) ?? report?.rows[0];
  return <section className="mb-6 min-w-0 rounded-xl border bg-card p-4 sm:p-5" aria-label="Customer acquisition and retention">
    <h2 className="text-base font-semibold">From advert to paying customer</h2>
    <p className="mt-1 text-sm text-muted-foreground">Compare Meta delivery with independently verified CRM and Stripe outcomes. Customer figures follow people created in each advertising period, through their latest verified outcome.</p>
    <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); setBusy(true); setApplied({ ...query }); }}>
      <div className="flex flex-wrap gap-2">{[7, 14, 30].map(days => <button type="button" key={days} className={control} onClick={() => rolling(days)}>Rolling {days} days</button>)}<button type="button" className={control} onClick={february}>Compare last month with February</button></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{([['since', 'From'], ['until', 'To'], ['compareSince', 'Compare from'], ['compareUntil', 'Compare to']] as const).map(([key, label]) => <label key={key} className="flex min-w-0 flex-col gap-1 text-xs">{label}<input type="date" required min="2026-01-01" max={accountLocalDate(new Date(), "Europe/London")} className={control} value={query[key]} onChange={e => setQuery(q => ({ ...q, [key]: e.target.value }))} /></label>)}</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">Breakdown<select aria-label="Acquisition breakdown" className={control} value={query.level} onChange={e => setQuery(q => ({ ...q, level: e.target.value as AcquisitionQuery['level'] }))}><option value="ad">Individual adverts</option><option value="adset">Ad sets</option><option value="campaign">Campaigns</option></select></label>
        <label className="flex flex-col gap-1 text-xs">History<select aria-label="History interval" className={control} value={query.grain} onChange={e => setQuery(q => ({ ...q, grain: e.target.value as AcquisitionQuery['grain'] }))}><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option></select></label>
        <label className="flex flex-col gap-1 text-xs">Attribution<select aria-label="Customer attribution touch" className={control} value={query.touch} onChange={e => setQuery(q => ({ ...q, touch: e.target.value as AcquisitionQuery['touch'] }))}><option value="first">First touch · acquisition</option><option value="latest">Latest touch · return visit</option></select></label>
        <button type="submit" disabled={busy} className="flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}Apply comparison</button>
      </div>
    </form>
    {error && <p role="alert" className="mt-4 rounded-lg border border-amber-500/40 p-3 text-sm">{error}{report && " The previous report remains below with its original dates."}</p>}
    {busy && !report && <p role="status" className="mt-4 text-sm">Reading stored performance and verified customer evidence…</p>}
    {report && <>
      <div className="mt-4 rounded-lg bg-muted/50 p-3 text-sm space-y-1" role="status">
        <p>Viewing {report.query.since}–{report.query.until}, compared with {report.query.compareSince}–{report.query.compareUntil}. {report.query.touch === "latest" && "Latest touch shows return-channel influence; it does not replace original acquisition."}</p>
        {(!report.health.currentCovered || !report.health.comparisonCovered) && <p className="font-medium text-amber-600">Historical coverage is incomplete. Missing performance stays unavailable until the backfill succeeds.</p>}
        {Boolean(report.health.metaOmittedRows) && <p className="text-amber-600">{report.health.metaOmittedRows} saved performance rows were omitted by a later completed Meta refresh. Their figures remain unavailable pending reconciliation.</p>}
        {!report.health.journeyCheckedAt ? <p>Verified customer sync is awaiting activation. Customer metrics are unavailable.</p> : <p>Across saved CRM history, {count(report.health.unmappedAdContacts)} paid Meta first-touch contacts have no verified ad ID; {count(report.health.unmatchedCustomers)} Stripe customers remain unmatched; {count(report.health.ambiguousCustomers)} have conflicting identities. {count(report.health.unmatchedCharges)} charges remain unmatched. Zero matched customers on an ad does not prove that it produced no customers.</p>}
        {report.health.journeyStale && <p className="text-amber-600">Customer evidence is stale. Last checked {report.health.journeyCheckedAt}.</p>}
        {report.health.journeyLastAttempt === "FAILED" && <p className="text-amber-600">The latest customer refresh failed. The last complete snapshot is retained.</p>}
        {report.health.metaStale && <p className="text-amber-600">Meta reporting is stale. Last successful refresh: {report.health.metaCheckedAt ?? "never"}.</p>}
        {report.health.metaLastAttempt === "FAILED" && <p className="text-amber-600">The latest Meta refresh failed. Stored history is retained.</p>}
        {Boolean(report.health.unmatchedCurrencyCharges) && <p>{report.health.unmatchedCurrencyCharges} payments in other currencies are excluded from GBP revenue.</p>}
        {report.health.recentProvisional && <p>Recent conversions are provisional. Delayed reporting and attribution windows can still revise them.</p>}
        {!report.health.qualificationConfigured && <p>Qualified leads are not verified: an existing populated qualification tag or stage has not been confirmed.</p>}
        {Boolean(report.health.attributionConflicts) && <p>{report.health.attributionConflicts} attribution conflicts are held for review; original first touch is preserved.</p>}
        {report.query.touch === "latest" && <p>Latest-touch groups describe returning contacts. Acquisition costs and customer profitability advice are unavailable in this mode.</p>}
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Advert performance comparison"><table className="w-full"><thead><tr>{['Advert / entity', 'Spend', 'Impressions', 'Meta leads', 'CPL', 'Link CTR', 'CPM', 'CPC · all clicks', 'Meta leads / link clicks', 'Daily frequency · weighted', 'CPL change', 'CTR change', 'CPM change'].map(s => <th className={th} key={s}>{s}</th>)}</tr></thead><tbody>{report.rows.map(r => <tr key={r.entityId} className="border-t"><td className={`${td} max-w-64 !whitespace-normal`}><button className="text-left underline underline-offset-2" onClick={() => setSelected(r.entityId)}>{r.name}</button></td><td className={td}>{money(r.current.metrics.spendCents)}</td><td className={td}>{count(r.current.metrics.impressions)}</td><td className={td}>{count(r.current.metrics.leads)}</td><td className={td}>{money(r.current.metrics.cplCents)}</td><td className={td}>{percent(r.current.metrics.ctrLink)}</td><td className={td}>{money(r.current.metrics.cpmCents)}</td><td className={td}>{money(r.current.metrics.cpcCents)}</td><td className={td}>{percent(r.current.indicativeLeadRate)}</td><td className={td}>{r.current.metrics.frequency?.toFixed(2) ?? '—'}</td><td className={td}>{delta(r.delta.cpl)}</td><td className={td}>{delta(r.delta.ctr)}</td><td className={td}>{delta(r.delta.cpm)}</td></tr>)}</tbody></table></div>
      {selectedRow && <div className="mt-4 space-y-3">
        <label className="flex flex-col gap-1 text-xs">Inspect advert or entity<select aria-label="Inspect acquisition entity" className={control} value={selectedRow.entityId} onChange={e => setSelected(e.target.value)}>{report.rows.map(r => <option key={r.entityId} value={r.entityId}>{r.name}</option>)}</select></label>
        <p className="text-sm">{selectedRow.recommendation}</p>
        <div className="overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Customer journey comparison"><table className="w-full"><thead><tr>{['Verified outcome', 'Selected period cohort', 'Comparison cohort'].map(s => <th key={s} className={th}>{s}</th>)}</tr></thead><tbody>{([
          ['CRM contacts with verified attribution', 'contacts'], ['Enquiries with form / tag evidence', 'leads'], ['Qualified · observed', 'qualified'], ['Meeting booked · observed', 'booked'], ['Meeting attended · showed', 'attended'], ['CRM won · observed, independent of payment', 'won'], ['Paying people · captured Stripe payment', 'payingCustomers'], ['Active paid subscribers', 'active'], ['Past due / unpaid subscribers', 'pastDue'], ['Ended subscriptions · churned people', 'churned'], ['Cancellation scheduled · still active', 'cancellationScheduled'], ['Subscription status not verified', 'subscriptionUnknown'], ['Failed Stripe charge attempts', 'failedPayments'],
        ] as const).map(([label, key]) => <tr key={key} className="border-t"><td className={td}>{label}</td><td className={td}>{count(selectedRow.current.customers?.[key])}</td><td className={td}>{count(selectedRow.comparison.customers?.[key])}</td></tr>)}{([
          ['Collected revenue', 'collected'], ['Refunds of captured payments', 'refunded'], ['Net collected revenue', 'net'], ['Cost per qualified lead', 'costPerQualified'], ['Cost per booked meeting', 'costPerMeeting'], ['Cost per paying customer', 'costPerCustomer'], ['Net revenue per paying customer', 'revenuePerCustomer'],
        ] as const).map(([label, key]) => <tr className="border-t" key={key}><td className={td}>{label}</td><td className={td}>{money(selectedRow.current.customers?.[key])}</td><td className={td}>{money(selectedRow.comparison.customers?.[key])}</td></tr>)}{[30, 90].map(days => <tr className="border-t" key={days}><td className={td}>{days}-day subscription retention</td>{[selectedRow.current, selectedRow.comparison].map((p, i) => <td className={td} key={i}>{p.customers ? retention(p.customers, days as 30 | 90) : "Not verified"}</td>)}</tr>)}</tbody></table></div>
        <div className="overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Historical performance"><table className="w-full"><thead><tr>{['Period', 'Spend', 'Impressions', 'Daily reach', 'Meta leads', 'CPL', 'Link CTR', 'CPM', 'Daily frequency · weighted'].map(s => <th className={th} key={s}>{s}</th>)}</tr></thead><tbody>{report.timeline.map(p => { const r = p.rows.find(r => r.entityId === selectedRow.entityId); return r ? <tr key={p.label} className="border-t"><td className={td}>{p.since}–{p.until}</td><td className={td}>{money(r.metrics.spendCents)}</td><td className={td}>{count(r.metrics.impressions)}</td><td className={td}>{r.dailyReach == null ? "Choose daily" : count(r.dailyReach)}</td><td className={td}>{count(r.metrics.leads)}</td><td className={td}>{money(r.metrics.cplCents)}</td><td className={td}>{percent(r.metrics.ctrLink)}</td><td className={td}>{money(r.metrics.cpmCents)}</td><td className={td}>{r.metrics.frequency?.toFixed(2) ?? "—"}</td></tr> : null; })}</tbody></table></div>
      </div>}
      {report.sources.length > 0 && <><h3 className="mt-5 text-sm font-semibold">Customer quality by recorded source</h3><p className="mt-1 text-xs text-muted-foreground">These source totals remain useful when ad IDs are missing. No spend is allocated to unmatched sources.</p><div className="mt-2 overflow-x-auto rounded-lg border" tabIndex={0} role="region" aria-label="Customer quality by source"><table className="w-full"><thead><tr>{['Source', 'CRM contacts', 'Paying people', 'Net revenue', 'Active', 'Churned', 'Payment failures', '30-day retention', '90-day retention'].map(s => <th className={th} key={s}>{s}</th>)}</tr></thead><tbody>{report.sources.map(s => <tr className="border-t" key={s.source}><td className={td}>{s.source}</td><td className={td}>{s.customers.contacts}</td><td className={td}>{s.customers.payingCustomers}</td><td className={td}>{money(s.customers.net)}</td><td className={td}>{s.customers.active}</td><td className={td}>{s.customers.churned}</td><td className={td}>{s.customers.failedPayments}</td><td className={td}>{retention(s.customers, 30)}</td><td className={td}>{retention(s.customers, 90)}</td></tr>)}</tbody></table></div></>}
      <details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer">How to interpret this report</summary><ul className="mt-2 list-disc space-y-2 pl-5">{report.explanations.map(text => <li key={text}>{text}</li>)}</ul><p className="mt-2">Reporting window: {report.attribution.reportingWindow ?? "unavailable"} · reporting date: {report.attribution.reportTime}. Ad set settings can differ, so Ads Manager totals may differ.</p>{report.attribution.adSets.map(a => <p key={a.id}>{a.name}: {a.specification ? JSON.stringify(a.specification) : "Attribution setting not collected yet"}</p>)}<p className="mt-2">Meta checked: {report.health.metaCheckedAt ?? "never"} · Customer evidence: {report.health.journeyCheckedAt ?? "not available"} · History begins: {report.health.historicalSince ?? "unknown"}.</p></details>
    </>}
  </section>;
}
