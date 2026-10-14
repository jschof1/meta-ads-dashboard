import type { DailyInsight, SyncRun } from "@prisma/client";
import { aggregateInsights } from "./read-model";
import { accountLocalDate, addCalendarDays, isDateInRange } from "./periods";
import type { Bucket } from "./state-types";
import type { JourneySnapshot } from "./customer-journey";

export type AcquisitionQuery = { since: string; until: string; compareSince: string; compareUntil: string; grain: "day" | "week" | "month"; level: "campaign" | "adset" | "ad"; touch: "first" | "latest" };
export function acquisitionQuery(params: URLSearchParams, now = new Date(), timeZone = "Europe/London"): AcquisitionQuery {
  const yesterday = addCalendarDays(accountLocalDate(now, timeZone), -1);
  const since = params.get("since") || addCalendarDays(yesterday, -29);
  const until = params.get("until") || yesterday;
  const length = (Date.parse(until) - Date.parse(since)) / 86_400_000 + 1;
  const compareUntil = params.get("compareUntil") || addCalendarDays(since, -1);
  const compareSince = params.get("compareSince") || addCalendarDays(compareUntil, -(length - 1));
  for (const [start, end] of [[since, until], [compareSince, compareUntil]]) {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
    if (!isDateInRange(start, { since: start, until: end }) || !isDateInRange(end, { since: start, until: end }) || days < 1 || days > 366 || start < "2026-01-01" || end > accountLocalDate(now, timeZone)) throw new Error("Choose valid dates from January 2026, no more than one year apart");
  }
  const grain = params.get("grain") ?? "month", level = params.get("level") ?? "ad", touch = params.get("touch") ?? "first";
  if (!["day", "week", "month"].includes(grain) || !["campaign", "adset", "ad"].includes(level) || !["first", "latest"].includes(touch)) throw new Error("Invalid reporting option");
  return { since, until, compareSince, compareUntil, grain: grain as AcquisitionQuery["grain"], level: level as AcquisitionQuery["level"], touch: touch as AcquisitionQuery["touch"] };
}

function dates(since: string, until: string) {
  const days: string[] = [];
  for (let day = since; day <= until; day = addCalendarDays(day, 1)) days.push(day);
  return days;
}
function covered(runs: Pick<SyncRun, "requestedSince" | "requestedUntil" | "warning">[], since: string, until: string) {
  return dates(since, until).every(day => {
    const latest = runs.find(run => run.requestedSince && run.requestedUntil && day >= run.requestedSince && day <= run.requestedUntil);
    // Skipped provider rows cannot establish zero delivery. Missing lead fields
    // on otherwise valid rows remain field-level unknowns instead.
    return latest && !/malformed insight row|invalid account timezone/i.test(latest.warning ?? "");
  });
}
const divide = (numerator: number | null, denominator: number | null) => numerator != null && denominator != null && denominator > 0 ? numerator / denominator : null;
const change = (a: number | null, b: number | null) => a != null && b != null && b !== 0 ? (a / b - 1) * 100 : null;

export type CustomerCohort = {
  contacts: number; leads: number; qualified: number | null; booked: number; attended: number; won: number;
  payingCustomers: number; collected: number; refunded: number; net: number; failedPayments: number;
  active: number; pastDue: number; churned: number; cancellationScheduled: number; subscriptionUnknown: number;
  retained30: number; eligible30: number; retained90: number; eligible90: number; medianObservedDays: number | null;
  costPerQualified: number | null; costPerMeeting: number | null; costPerCustomer: number | null; revenuePerCustomer: number | null;
};

export function cohortMetrics(snapshot: JourneySnapshot, contactIds: Set<string>, spend: number | null, until: string): CustomerCohort {
  const contacts = snapshot.contacts.filter(c => contactIds.has(c.id));
  const asOf = Date.parse(snapshot.checkedAt);
  const charges = snapshot.charges.filter(c => c.contactId && contactIds.has(c.contactId) && c.currency === "GBP" && Date.parse(c.at) <= asOf);
  // Count distinct CRM people; repeat charges and multiple Stripe customer IDs
  // cannot become additional acquisitions.
  const payerIds = new Set(charges.filter(c => c.collected > 0).map(c => c.contactId!));
  const firstPaid = (contactId: string) => Math.min(...charges.filter(c => c.contactId === contactId && c.collected > 0).map(c => Date.parse(c.at)));
  let active = 0, pastDue = 0, churned = 0, cancellationScheduled = 0, subscriptionUnknown = 0;
  const durations: number[] = [];
  let eligible30 = 0, retained30 = 0, eligible90 = 0, retained90 = 0;
  for (const contactId of payerIds) {
    const subs = snapshot.subscriptions.filter(s => s.contactId === contactId);
    const current = subs.filter(s => !s.endedAt && ["active", "trialing", "past_due", "unpaid", "paused"].includes(s.status));
    if (current.some(s => s.status === "active")) active++;
    if (current.some(s => ["past_due", "unpaid"].includes(s.status))) pastDue++;
    if (current.some(s => s.cancelScheduled)) cancellationScheduled++;
    const unverifiable = !subs.length || subs.some(s => s.endedAt
      ? !["canceled", "incomplete_expired"].includes(s.status) || Date.parse(s.endedAt) < Date.parse(s.startedAt)
      : !["active", "trialing", "past_due", "unpaid", "paused"].includes(s.status));
    if (unverifiable) subscriptionUnknown++;
    const ended = !unverifiable && !current.length && subs.length > 0 && subs.every(s => s.endedAt);
    if (ended) churned++;
    const paidAt = firstPaid(contactId);
    const end = ended ? Math.max(...subs.map(s => Date.parse(s.endedAt!))) : asOf;
    if (!unverifiable && (current.length || ended)) durations.push(Math.max(0, (end - paidAt) / 86_400_000));
    for (const n of [30, 90]) {
      const milestone = paidAt + n * 86_400_000;
      // Right censor young and unverifiable cohorts. Renewal/replacement
      // subscriptions are joined by the verified customer/contact identity.
      if (milestone > asOf || unverifiable) continue;
      const retained = subs.some(s => Date.parse(s.startedAt) <= milestone && (!s.endedAt || Date.parse(s.endedAt) > milestone));
      if (n === 30) { eligible30++; if (retained) retained30++; }
      else { eligible90++; if (retained) retained90++; }
    }
  }
  durations.sort((a, b) => a - b);
  const qualified = snapshot.qualificationConfigured ? contacts.filter(c => c.qualified === true).length : null;
  const collected = charges.reduce((n, c) => n + c.collected, 0), refunded = charges.reduce((n, c) => n + c.refunded, 0);
  const booked = contacts.filter(c => c.booked).length;
  // These are outcomes observed by checkedAt for a lead-created cohort, not
  // payments during the selected spend dates. until is retained in the public
  // API to make that distinction explicit at the caller.
  void until;
  return {
    contacts: contacts.length, leads: contacts.filter(c => c.leadAt).length, qualified, booked, attended: contacts.filter(c => c.attended).length, won: contacts.filter(c => c.won).length,
    payingCustomers: payerIds.size, collected, refunded, net: collected - refunded, failedPayments: charges.filter(c => c.failed).length,
    active, pastDue, churned, cancellationScheduled, subscriptionUnknown, retained30, eligible30, retained90, eligible90,
    medianObservedDays: durations.length ? (durations[Math.floor((durations.length - 1) / 2)] + durations[Math.floor(durations.length / 2)]) / 2 : null,
    costPerQualified: divide(spend, qualified), costPerMeeting: divide(spend, booked), costPerCustomer: divide(spend, payerIds.size), revenuePerCustomer: divide(collected - refunded, payerIds.size),
  };
}

export function buildAcquisitionReport(input: {
  query: AcquisitionQuery; insights: DailyInsight[]; runs: SyncRun[]; journey: JourneySnapshot | null;
  names: Map<string, string>; now?: Date; latestJourneyAttempt?: { status: string; finishedAt: Date | null } | null;
  attributionKey?: string; adSetAttribution?: { id: string; name: string; specification: unknown }[];
  latestMetaAttempt?: { status: string } | null;
  metaOmittedRows?: number;
}) {
  const { query: q, insights, runs, journey } = input;
  const coverageRuns = [...runs].sort((a, b) => +(b.finishedAt ?? 0) - +(a.finishedAt ?? 0));
  const now = input.now ?? new Date();
  const window = (since: string, until: string, entityId: string) => {
    const rows = insights.filter(r => r.level === q.level && r.entityId === entityId && r.date >= since && r.date <= until);
    const complete = covered(coverageRuns, since, until);
    const metrics: Bucket = aggregateInsights(rows);
    if (!complete) Object.keys(metrics).forEach(k => { metrics[k as keyof Bucket] = null; });
    else if (!rows.length) { metrics.spendCents = 0; metrics.impressions = 0; metrics.linkClicks = 0; metrics.leads = 0; }
    const customers = journey ? journey.contacts.filter(c => {
      const date = c.createdAt ? accountLocalDate(new Date(c.createdAt), "Europe/London") : null;
      const touch = c.attribution[q.touch];
      const target = q.level === "ad" ? touch.adId : q.level === "adset" ? touch.adSetId : touch.campaignId;
      return date && date >= since && date <= until && target === entityId;
    }) : [];
    return { since, until, complete, metrics, indicativeLeadRate: divide(metrics.leads, metrics.linkClicks), dailyReach: since === until && rows.length === 1 ? rows[0].reach : null, customers: journey ? cohortMetrics(journey, new Set(customers.map(c => c.id)), q.touch === "first" ? metrics.spendCents : null, until) : null };
  };
  const ids = new Set(insights.filter(r => r.level === q.level).map(r => r.entityId));
  const rows = [...ids].map(entityId => {
    const current = window(q.since, q.until, entityId), comparison = window(q.compareSince, q.compareUntil, entityId);
    const delta = { cpl: change(current.metrics.cplCents, comparison.metrics.cplCents), ctr: change(current.metrics.ctrLink, comparison.metrics.ctrLink), cpm: change(current.metrics.cpmCents, comparison.metrics.cpmCents), frequency: change(current.metrics.frequency, comparison.metrics.frequency) };
    const available = current.complete && comparison.complete && (current.metrics.impressions ?? 0) >= 1000 && (comparison.metrics.impressions ?? 0) >= 1000;
    const weakLeads = (current.metrics.leads ?? 0) < 10 || (comparison.metrics.leads ?? 0) < 10;
    const deteriorating = available && !weakLeads && (delta.cpl ?? 0) >= 20 && ((delta.ctr ?? 0) <= -15 || (delta.cpm ?? 0) >= 20);
    // Campaign age is not an input to the fatigue signal. The sustained check
    // needs independently complete weekly samples, not one partial day.
    const end = q.until, weekly = [0, 1, 2].map(i => {
      const until = addCalendarDays(end, -7 * i); return window(addCalendarDays(until, -6), until, entityId);
    });
    const weeklyCpl = weekly.map(w => w.metrics.cplCents);
    const sustained = weekly.every(w => w.complete && (w.metrics.leads ?? 0) >= 5 && (w.metrics.impressions ?? 0) >= 1000)
      && weeklyCpl.every(v => v != null) && weeklyCpl[0]! > weeklyCpl[1]! && weeklyCpl[1]! > weeklyCpl[2]!;
    let recommendation = "Insufficient evidence for a customer profitability decision. Check attribution before moving budget.";
    if (deteriorating) recommendation = sustained ? "Sustained deterioration across three weekly samples. Review creative and audience overlap; prepare a controlled creative test." : "Compared-period deterioration. Check auction costs, landing-page conversion and creative before changing spend.";
    if (q.touch === "first" && current.customers && current.customers.payingCustomers >= 10 && current.customers.net > (current.metrics.spendCents ?? Infinity)) recommendation = "Observed customer revenue exceeds cohort spend. Check service margin, retention and unattributed coverage before considering more budget.";
    if (q.touch === "latest") recommendation += " Latest-touch groups describe return visits; acquisition costs and profitability advice require first-touch attribution.";
    return { entityId, name: input.names.get(entityId) ?? entityId, current, comparison, delta, fatigue: deteriorating && sustained ? "review" : "insufficient_evidence", recommendation };
  }).sort((a, b) => (b.current.metrics.spendCents ?? -1) - (a.current.metrics.spendCents ?? -1));
  const periods = new Map<string, { since: string; until: string }>();
  for (const day of dates(q.since, q.until)) {
    const key = q.grain === "month" ? day.slice(0, 7) : q.grain === "week" ? addCalendarDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7)) : day;
    const period = periods.get(key); periods.set(key, { since: period?.since ?? day, until: day });
  }
  const timeline = [...periods].map(([label, range]) => ({ label, ...range, rows: [...ids].map(entityId => ({ entityId, ...window(range.since, range.until, entityId) })) }));
  const sourceContacts = journey?.contacts.filter(c => {
    const day = c.createdAt ? accountLocalDate(new Date(c.createdAt), "Europe/London") : null;
    return day && day >= q.since && day <= q.until;
  }) ?? [];
  const sources = journey ? [...new Set(sourceContacts.map(c => c.attribution[q.touch].source ?? "unattributed"))].map(source => ({
    source,
    customers: cohortMetrics(journey, new Set(sourceContacts.filter(c => (c.attribution[q.touch].source ?? "unattributed") === source).map(c => c.id)), null, q.until),
  })) : [];
  return {
    query: q, currency: "GBP", generatedAt: now.toISOString(), rows, timeline, sources,
    health: {
      metaOmittedRows: input.metaOmittedRows ?? 0,
      historicalSince: insights.map(r => r.date).sort()[0] ?? null,
      currentCovered: covered(coverageRuns, q.since, q.until), comparisonCovered: covered(coverageRuns, q.compareSince, q.compareUntil),
      metaCheckedAt: runs.map(r => r.finishedAt).filter((v): v is Date => !!v).sort((a, b) => +b - +a)[0]?.toISOString() ?? null,
      metaStale: !runs.some(r => r.finishedAt && +now - +r.finishedAt <= 30 * 3600_000), metaLastAttempt: input.latestMetaAttempt?.status ?? null,
      journeyCheckedAt: journey?.checkedAt ?? null, journeyStale: journey ? +now - Date.parse(journey.checkedAt) > 26 * 3600_000 : null,
      journeyLastAttempt: input.latestJourneyAttempt?.status ?? null, ...(journey?.health ?? {}),
      recentProvisional: q.until > addCalendarDays(accountLocalDate(now, "Europe/London"), -8),
      qualificationConfigured: journey?.qualificationConfigured ?? false,
      unmatchedCurrencyCharges: journey?.charges.filter(c => c.currency !== "GBP").length ?? null,
    },
    attribution: { reportingWindow: input.attributionKey ?? null, reportTime: "conversion", adSets: input.adSetAttribution ?? [] },
    explanations: [
      "Meta reports conversions on conversion date using the stored explicit attribution window. CRM cohorts use contact creation date and preserve first and latest touch separately.",
      "Latest-touch customer groups use the latest recorded source for contact-created cohorts. They are descriptive return-visit groups; acquisition costs and customer profitability recommendations are withheld in that mode.",
      "Meta leads / link clicks is an indicative ratio across reporting dates, including view-through conversions. It is not a verified click-to-customer conversion rate. Failed payments count failed Stripe charge attempts; failures without a charge are not included.",
      "Customer revenue is the verified cohort's captured Stripe payments less refunds observed by the last sync, including later renewals. It is not cash collected only during the advertising dates.",
      "Reach is available for a single day. Across days it cannot be added into a unique audience; frequency is a weighted daily diagnostic.",
      "The latest eight days are provisional. Daily syncs recheck 35 days; late provider corrections outside that window require a historical refresh.",
      "Retention uses subscription start/end timestamps; young cohorts are excluded from 30/90-day eligibility. Active durations are ongoing observations, not lifetime forecasts.",
      "Meta and CRM counts measure different things and cannot establish event loss or deduplication failures on their own. Test Events and native workflow logs must verify delivery.",
    ],
  };
}
export type AcquisitionReport = ReturnType<typeof buildAcquisitionReport>;
