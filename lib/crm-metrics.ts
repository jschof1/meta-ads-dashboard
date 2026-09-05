import { currencyMinorUnitScale } from "@/lib/format";
import { accountLocalDate } from "@/lib/periods";
import { ATTRIBUTION_GRANULARITIES, type AttributionGranularity } from "@/lib/crm-attribution";
import type {
  CrmAttributionBreakdown,
  CrmCounts,
  CrmDashboardState,
  CrmPerformanceByEntity,
  CrmRates,
  CrmRevenue,
} from "@/lib/state-types";

export type CrmContactMetricRow = {
  highLevelId: string;
  locationId: string;
  dateAdded: string | null;
  attributionGranularity: string;
  metaAdId: string | null;
  metaCampaignId: string | null;
};

export type CrmOpportunityMetricRow = {
  highLevelId: string;
  locationId: string;
  contactId: string | null;
  pipelineId: string;
  status: string;
  semanticStage: string | null;
  valueMajorUnits: number | null;
  createdAtProvider: string | null;
  updatedAtProvider: string | null;
  lastStageChangeAt: string | null;
  lastStatusChangeAt: string | null;
};

export type CrmMetaEntityMetricInput = {
  granularity: "campaign" | "ad";
  id: string;
  name: string;
  spendMinorUnits: number | null;
  leads: number | null;
};

export type CrmMetricsInput = {
  scope: { locationId: string; pipelineId: string };
  contacts: CrmContactMetricRow[];
  opportunities: CrmOpportunityMetricRow[];
  period: { since: string; until: string; timeZone: string; label: string };
  meta: {
    spendMinorUnits: number | null;
    leads: number | null;
    currencyCode: string | null;
    entities: CrmMetaEntityMetricInput[];
  };
  highLevelCurrencyCode: string | null;
};

type CohortRecord = {
  contact: CrmContactMetricRow;
  opportunity: CrmOpportunityMetricRow | null;
  granularity: AttributionGranularity;
};

const STAGE_RANK: Record<string, number> = {
  lead: 1,
  contacted: 2,
  qualified: 3,
  callBooked: 4,
  callAttended: 5,
  wonCustomer: 6,
  lost: 0,
};

function emptyCounts(metaLeads: number | null): CrmCounts {
  return {
    crmRecords: null,
    attributedRecords: null,
    paidMetaRecords: null,
    metaLeads,
    contacted: null,
    qualified: null,
    callsBooked: null,
    callsAttended: null,
    wonCustomers: null,
    lostCustomers: null,
  };
}

function emptyRates(): CrmRates {
  return {
    leadToContacted: null,
    contactedToQualified: null,
    qualifiedToBooked: null,
    bookedToAttended: null,
    attendedToWon: null,
    showRate: null,
    closeRate: null,
  };
}

function emptyRevenue(currencyCode: string | null, status: CrmRevenue["status"] = "unknown"): CrmRevenue {
  return { minorUnits: null, currencyCode, status, roas: null };
}

function emptyBreakdown(): CrmAttributionBreakdown[] {
  return ATTRIBUTION_GRANULARITIES.map((granularity) => ({
    granularity,
    records: null,
    contacted: null,
    qualified: null,
    callsBooked: null,
    callsAttended: null,
    wonCustomers: null,
    lostCustomers: null,
    attributedRevenueMinorUnits: null,
    revenueStatus: "unknown" as const,
  }));
}

export function emptyCrmMetrics(metaLeads: number | null, currencyCode: string | null = null): Pick<CrmDashboardState, "counts" | "rates" | "costs" | "revenue" | "attributionBreakdown" | "performanceByEntity" | "warnings" | "dataQuality"> {
  return {
    counts: emptyCounts(metaLeads),
    rates: emptyRates(),
    costs: { qualifiedLeadCostMinorUnits: null, bookedCallCostMinorUnits: null, customerCacMinorUnits: null },
    revenue: emptyRevenue(currencyCode),
    attributionBreakdown: emptyBreakdown(),
    performanceByEntity: [],
    warnings: [],
    dataQuality: "unknown",
  };
}

function granularity(value: string): AttributionGranularity {
  return (ATTRIBUTION_GRANULARITIES as readonly string[]).includes(value)
    ? value as AttributionGranularity
    : "unattributed";
}

function localDate(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : accountLocalDate(date, timeZone);
}

function timestamp(opportunity: CrmOpportunityMetricRow): number {
  for (const value of [opportunity.updatedAtProvider, opportunity.lastStageChangeAt, opportunity.lastStatusChangeAt, opportunity.createdAtProvider]) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function bestOpportunity(opportunities: CrmOpportunityMetricRow[]): CrmOpportunityMetricRow | null {
  if (opportunities.length === 0) return null;
  const candidates = [...opportunities].sort((left, right) => {
    const leftStage = STAGE_RANK[left.semanticStage ?? ""] ?? -1;
    const rightStage = STAGE_RANK[right.semanticStage ?? ""] ?? -1;
    if (left.semanticStage === "wonCustomer" && right.semanticStage !== "wonCustomer") return -1;
    if (right.semanticStage === "wonCustomer" && left.semanticStage !== "wonCustomer") return 1;
    if (left.semanticStage === "lost" && right.semanticStage !== "lost" && right.semanticStage !== "wonCustomer") return -1;
    if (right.semanticStage === "lost" && left.semanticStage !== "lost" && left.semanticStage !== "wonCustomer") return 1;
    if (leftStage !== rightStage) return rightStage - leftStage;
    return timestamp(right) - timestamp(left);
  });
  return candidates[0] ?? null;
}

function isPaidMeta(granularityValue: AttributionGranularity): boolean {
  return granularityValue !== "unattributed";
}

function countRecords(records: CohortRecord[]): Omit<CrmCounts, "metaLeads" | "crmRecords" | "attributedRecords" | "paidMetaRecords"> {
  const counts = { contacted: 0, qualified: 0, callsBooked: 0, callsAttended: 0, wonCustomers: 0, lostCustomers: 0 };
  for (const record of records) {
    const stage = record.opportunity?.semanticStage ?? null;
    if (stage === "lost") {
      counts.lostCustomers += 1;
      continue;
    }
    const rank = stage ? STAGE_RANK[stage] ?? -1 : -1;
    if (rank >= STAGE_RANK.contacted) counts.contacted += 1;
    if (rank >= STAGE_RANK.qualified) counts.qualified += 1;
    if (rank >= STAGE_RANK.callBooked) counts.callsBooked += 1;
    if (rank >= STAGE_RANK.callAttended) counts.callsAttended += 1;
    if (rank >= STAGE_RANK.wonCustomer) counts.wonCustomers += 1;
  }
  return counts;
}

function rate(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  return numerator / denominator;
}

function unitCost(spendMinorUnits: number | null, count: number | null): number | null {
  if (spendMinorUnits == null || count == null || count <= 0 || spendMinorUnits < 0) return null;
  return Math.round(spendMinorUnits / count);
}

function validValue(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}

function revenueFor(
  records: CohortRecord[],
  highLevelCurrencyCode: string | null,
  metaCurrencyCode: string | null,
): CrmRevenue {
  const currencyCode = metaCurrencyCode ?? highLevelCurrencyCode;
  if (records.length === 0) return emptyRevenue(currencyCode, "unknown");
  if (!highLevelCurrencyCode || !metaCurrencyCode) return emptyRevenue(currencyCode, "unknown");
  if (highLevelCurrencyCode.toUpperCase() !== metaCurrencyCode.toUpperCase()) return emptyRevenue(metaCurrencyCode, "incomplete");
  const scale = currencyMinorUnitScale(metaCurrencyCode);
  if (scale == null) return emptyRevenue(metaCurrencyCode, "unknown");
  const won = records.filter((record) => record.opportunity?.semanticStage === "wonCustomer");
  if (won.some((record) => validValue(record.opportunity?.valueMajorUnits ?? null) == null)) return emptyRevenue(metaCurrencyCode, "incomplete");
  const minorUnits = Math.round(won.reduce((total, record) => total + (record.opportunity?.valueMajorUnits ?? 0) * scale, 0));
  return { minorUnits, currencyCode: metaCurrencyCode, status: "complete", roas: null };
}

function withRoas(revenue: CrmRevenue, spendMinorUnits: number | null): CrmRevenue {
  return {
    ...revenue,
    roas: revenue.status === "complete" && revenue.minorUnits != null && spendMinorUnits != null && spendMinorUnits > 0
      ? revenue.minorUnits / spendMinorUnits
      : null,
  };
}

function breakdownFor(
  records: CohortRecord[],
  highLevelCurrencyCode: string | null,
  metaCurrencyCode: string | null,
): CrmAttributionBreakdown[] {
  return ATTRIBUTION_GRANULARITIES.map((label) => {
    const selected = records.filter((record) => record.granularity === label);
    const counts = countRecords(selected);
    // A won unattributed contact can be a real customer, but its revenue is
    // not defensibly attributable to Meta.
    const revenue = label === "unattributed"
      ? emptyRevenue(metaCurrencyCode, "unknown")
      : revenueFor(selected, highLevelCurrencyCode, metaCurrencyCode);
    return {
      granularity: label,
      records: selected.length,
      ...counts,
      attributedRevenueMinorUnits: revenue.minorUnits,
      revenueStatus: revenue.status,
    };
  });
}

function entityPerformance(
  entity: CrmMetaEntityMetricInput,
  records: CohortRecord[],
  highLevelCurrencyCode: string | null,
  metaCurrencyCode: string | null,
): CrmPerformanceByEntity {
  const selected = records.filter((record) => entity.granularity === "ad"
    ? record.contact.metaAdId === entity.id && record.granularity === "ad"
    : record.contact.metaCampaignId === entity.id && (record.granularity === "campaign" || record.granularity === "ad"));
  const counts = countRecords(selected);
  const revenue = revenueFor(selected, highLevelCurrencyCode, metaCurrencyCode);
  return {
    granularity: entity.granularity,
    id: entity.id,
    name: entity.name,
    metaSpendMinorUnits: entity.spendMinorUnits,
    metaLeads: entity.leads,
    metaCplMinorUnits: unitCost(entity.spendMinorUnits, entity.leads),
    qualifiedLeads: counts.qualified,
    qualifiedLeadCostMinorUnits: unitCost(entity.spendMinorUnits, counts.qualified),
    wonCustomers: counts.wonCustomers,
    customerCacMinorUnits: unitCost(entity.spendMinorUnits, counts.wonCustomers),
    attributedRevenueMinorUnits: revenue.minorUnits,
    revenueStatus: revenue.status,
    roas: withRoas(revenue, entity.spendMinorUnits).roas,
  };
}

export function buildCrmMetrics(input: CrmMetricsInput): Pick<CrmDashboardState, "counts" | "rates" | "costs" | "revenue" | "attributionBreakdown" | "performanceByEntity" | "warnings" | "dataQuality"> {
  const warnings: string[] = [];
  const contacts = Array.from(new Map(input.contacts
    .filter((contact) => contact.highLevelId && contact.locationId === input.scope.locationId)
    .map((contact) => [contact.highLevelId, contact])).values());
  const opportunities = Array.from(new Map(input.opportunities
    .filter((opportunity) => opportunity.highLevelId && opportunity.locationId === input.scope.locationId && opportunity.pipelineId === input.scope.pipelineId)
    .map((opportunity) => [opportunity.highLevelId, opportunity])).values());
  const opportunitiesByContact = new Map<string, CrmOpportunityMetricRow[]>();
  for (const opportunity of opportunities) {
    if (!opportunity.contactId) continue;
    const current = opportunitiesByContact.get(opportunity.contactId) ?? [];
    current.push(opportunity);
    opportunitiesByContact.set(opportunity.contactId, current);
  }

  const datedContacts: CrmContactMetricRow[] = [];
  let missingDates = 0;
  for (const contact of contacts) {
    const date = localDate(contact.dateAdded, input.period.timeZone);
    if (!date) {
      missingDates += 1;
      continue;
    }
    if (date >= input.period.since && date <= input.period.until) datedContacts.push(contact);
  }
  if (missingDates > 0) warnings.push(`${missingDates} CRM contact(s) had no usable creation date and were excluded from the ${input.period.label} cohort.`);
  const dataQuality = contacts.length > 0 && datedContacts.length === 0 && missingDates > 0
    ? "unknown"
    : missingDates > 0 ? "partial" : "complete";
  if (dataQuality === "unknown") {
    const empty = emptyCrmMetrics(input.meta.leads, input.meta.currencyCode);
    return { ...empty, warnings, dataQuality };
  }

  const records: CohortRecord[] = datedContacts.map((contact) => ({
    contact,
    opportunity: bestOpportunity(opportunitiesByContact.get(contact.highLevelId) ?? []),
    granularity: granularity(contact.attributionGranularity),
  }));
  const countsBase = countRecords(records);
  const attributedRecords = records.filter((record) => record.granularity !== "unattributed").length;
  const paidMetaRecords = records.filter((record) => isPaidMeta(record.granularity)).length;
  const counts: CrmCounts = {
    crmRecords: records.length,
    attributedRecords,
    paidMetaRecords,
    metaLeads: input.meta.leads,
    ...countsBase,
  };
  const rates: CrmRates = {
    leadToContacted: rate(counts.contacted, counts.crmRecords),
    contactedToQualified: rate(counts.qualified, counts.contacted),
    qualifiedToBooked: rate(counts.callsBooked, counts.qualified),
    bookedToAttended: rate(counts.callsAttended, counts.callsBooked),
    attendedToWon: rate(counts.wonCustomers, counts.callsAttended),
    showRate: rate(counts.callsAttended, counts.callsBooked),
    closeRate: rate(counts.wonCustomers, counts.callsAttended),
  };
  const paidRecords = records.filter((record) => isPaidMeta(record.granularity));
  const paidCounts = countRecords(paidRecords);
  const revenue = withRoas(revenueFor(paidRecords, input.highLevelCurrencyCode, input.meta.currencyCode), input.meta.spendMinorUnits);
  if (paidRecords.some((record) => record.opportunity?.semanticStage == null) && opportunities.length > 0) {
    warnings.push("Some CRM records have no mapped HighLevel stage; downstream counts exclude those records.");
  }
  if (opportunities.some((opportunity) => opportunity.contactId == null)) warnings.push("Some HighLevel opportunities were not linked to a contact and are excluded from contact-cohort metrics.");
  if (revenue.status === "incomplete") warnings.push("Attributed revenue is incomplete because the configured currency or one or more won values did not validate.");
  if (revenue.status === "unknown") warnings.push("Attributed revenue and ROAS remain unknown until HighLevel and Meta currency evidence is available.");

  const entities = input.meta.entities
    .filter((entity) => entity.id)
    .map((entity) => entityPerformance(entity, records, input.highLevelCurrencyCode, input.meta.currencyCode));
  const duplicateIds = input.contacts.length - contacts.length;
  if (duplicateIds > 0) warnings.push(`${duplicateIds} duplicate CRM contact snapshot row(s) were collapsed by HighLevel id.`);
  const unknownStages = opportunities.filter((opportunity) => opportunity.semanticStage == null).length;
  if (unknownStages > 0) warnings.push(`${unknownStages} opportunity row(s) have an unmapped stage or status and remain visible only as unmapped CRM data.`);

  return {
    counts,
    rates,
    costs: {
      qualifiedLeadCostMinorUnits: unitCost(input.meta.spendMinorUnits, paidCounts.qualified),
      bookedCallCostMinorUnits: unitCost(input.meta.spendMinorUnits, paidCounts.callsBooked),
      customerCacMinorUnits: unitCost(input.meta.spendMinorUnits, paidCounts.wonCustomers),
    },
    revenue,
    attributionBreakdown: breakdownFor(records, input.highLevelCurrencyCode, input.meta.currencyCode),
    performanceByEntity: entities,
    warnings,
    dataQuality,
  };
}
