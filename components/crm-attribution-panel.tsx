"use client";

import type { CrmAttributionGranularity, CrmDashboardState, DashboardState } from "@/lib/state-types";
import { formatCount, formatMoney, formatPercent } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABEL: Record<CrmDashboardState["status"], string> = {
  not_configured: "HighLevel not configured",
  disabled: "HighLevel polling disabled",
  misconfigured: "HighLevel mapping needs attention",
  never: "Awaiting first HighLevel snapshot",
  running: "HighLevel sync running",
  fresh: "HighLevel snapshot fresh",
  stale: "HighLevel snapshot stale",
  failed: "Latest HighLevel sync failed",
};

const GRANULARITY_LABEL: Record<CrmAttributionGranularity, string> = {
  ad: "Meta ad",
  campaign: "Meta campaign",
  "paid-meta": "Paid Meta",
  unattributed: "Unattributed",
};

function metric(value: number | null): string {
  return formatCount(value);
}

function percent(value: number | null): string {
  return formatPercent(value, 1);
}

function money(value: number | null, status: "complete" | "incomplete" | "unknown", currencyCode: string | null): string {
  if (status === "complete") return formatMoney(value, currencyCode);
  return status === "incomplete" ? "Incomplete" : "Unknown";
}

function statusVariant(status: CrmDashboardState["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed" || status === "misconfigured") return "destructive";
  if (status === "fresh") return "default";
  return "outline";
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function CrmAttributionPanel({ state }: { state: DashboardState }) {
  const crm = state.crm;
  const currency = crm.revenue.currencyCode ?? state.meta.currencyCode;
  const hasMetrics = crm.counts.crmRecords != null;
  return (
    <Card className="mb-6">
      <CardHeader className="border-b border-border">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>HighLevel customer attribution</CardTitle>
            <CardDescription className="mt-1">
              {crm.period.label} contact-created cohort · CRM outcomes stay separate from Meta-reported leads.
            </CardDescription>
          </div>
          <Badge variant={statusVariant(crm.status)}>{STATUS_LABEL[crm.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!hasMetrics && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground/80">
            {crm.status === "not_configured"
              ? "Meta leads are available above, but HighLevel location, pipeline and every funnel-stage mapping are not configured. No CRM outcomes are inferred."
              : crm.status === "never"
                ? "The explicit HighLevel mapping is present, but no successful read-only snapshot is stored yet. CRM counts remain unknown."
                : crm.status === "disabled"
                  ? "Polling is disabled. Stored CRM data, if any, remains read-only until the explicit sync gate is enabled."
                  : "CRM outcomes are currently unavailable or stale. The dashboard has not replaced them with zeroes."}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="CRM records" value={metric(crm.counts.crmRecords)} detail="Distinct HighLevel contacts" />
          <Stat label="Meta leads" value={metric(crm.counts.metaLeads)} detail="Meta-reported result" />
          <Stat label="Paid Meta records" value={metric(crm.counts.paidMetaRecords)} detail="CRM contacts classified paid Meta" />
          <Stat label="Qualified leads" value={metric(crm.counts.qualified)} detail="Mapped CRM stage" />
          <Stat label="Booked calls" value={metric(crm.counts.callsBooked)} detail="Mapped CRM stage" />
          <Stat label="Attended calls" value={metric(crm.counts.callsAttended)} detail="Showed / attended" />
          <Stat label="Won customers" value={metric(crm.counts.wonCustomers)} detail="Mapped won status" />
          <Stat label="Lost" value={metric(crm.counts.lostCustomers)} detail="Mapped lost status" />
        </div>

        <div>
          <h3 className="text-sm font-semibold">Downstream rates and unit economics</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Lead → contacted" value={percent(crm.rates.leadToContacted)} />
            <Stat label="Contacted → qualified" value={percent(crm.rates.contactedToQualified)} />
            <Stat label="Qualified → booked" value={percent(crm.rates.qualifiedToBooked)} />
            <Stat label="Show rate" value={percent(crm.rates.showRate)} />
            <Stat label="Close rate" value={percent(crm.rates.closeRate)} />
            <Stat label="Qualified lead cost" value={money(crm.costs.qualifiedLeadCostMinorUnits, "complete", currency)} />
            <Stat label="Booked-call cost" value={money(crm.costs.bookedCallCostMinorUnits, "complete", currency)} />
            <Stat label="Customer CAC" value={money(crm.costs.customerCacMinorUnits, "complete", currency)} />
            <Stat label="Attributed revenue" value={money(crm.revenue.minorUnits, crm.revenue.status, currency)} detail={crm.revenue.status === "complete" ? currency ?? "Account currency" : "Not defensible yet"} />
            <Stat label="ROAS" value={crm.revenue.status === "complete" && crm.revenue.roas != null ? `${crm.revenue.roas.toFixed(2)}×` : crm.revenue.status === "incomplete" ? "Incomplete" : "Unknown"} />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Attribution granularity</h3>
          <p className="mt-1 text-xs text-muted-foreground">Explicit ad and campaign custom-field IDs take priority. Everything else remains visible at the honest level of evidence.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {crm.attributionBreakdown.map((row) => (
              <div key={row.granularity} className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium">{GRANULARITY_LABEL[row.granularity]}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{metric(row.records)}</p>
                <p className="text-[11px] text-muted-foreground">{metric(row.qualified)} qualified · {metric(row.wonCustomers)} won</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Revenue: {money(row.attributedRevenueMinorUnits, row.revenueStatus, currency)}</p>
              </div>
            ))}
          </div>
        </div>

        {crm.performanceByEntity.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold">Meta entity comparison</h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Entity</th>
                    <th className="px-3 py-2 text-right font-medium">Meta CPL</th>
                    <th className="px-3 py-2 text-right font-medium">Qualified cost</th>
                    <th className="px-3 py-2 text-right font-medium">Customers</th>
                    <th className="px-3 py-2 text-right font-medium">CAC</th>
                    <th className="px-3 py-2 text-right font-medium">Revenue / ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {crm.performanceByEntity.map((row) => (
                    <tr key={`${row.granularity}:${row.id}`} className="border-t border-border">
                      <td className="px-3 py-2">
                        <span className="font-medium">{row.name}</span>
                        <span className="block text-[10px] text-muted-foreground">{row.granularity} · {row.id}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.metaCplMinorUnits, "complete", currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.qualifiedLeadCostMinorUnits, "complete", currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{metric(row.wonCustomers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.customerCacMinorUnits, "complete", currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(row.attributedRevenueMinorUnits, row.revenueStatus, currency)}
                        <span className="block text-[10px] text-muted-foreground">{row.revenueStatus === "complete" && row.roas != null ? `${row.roas.toFixed(2)}× ROAS` : row.revenueStatus}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {crm.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold">CRM data notes</p>
            <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground space-y-1">
              {crm.warnings.slice(0, 6).map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          CRM snapshot: {crm.lastSyncAt ? new Date(crm.lastSyncAt).toLocaleString("en-GB", { timeZone: state.meta.timezoneName ?? "UTC" }) : "Never"} · Location {crm.locationId || "not configured"} · Pipeline {crm.pipelineId || "not configured"}
        </p>
      </CardContent>
    </Card>
  );
}
