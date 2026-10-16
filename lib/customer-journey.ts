import { z } from "zod";
import { object, boundedText as text, preserveAttribution, resolveCustomerIdentities, type IdentityEvidence, type MetaIdentity } from "./acquisition-attribution";

const touch = z.object({ source: z.string().nullable(), medium: z.string().nullable(), campaignId: z.string().nullable(), adSetId: z.string().nullable(), adId: z.string().nullable(), paidMeta: z.boolean(), hierarchyConflict: z.boolean().default(false), providerTouchKey: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null) });
export const journeySnapshotSchema = z.object({
  version: z.literal(1), accountId: z.literal("acct_1OuZwXBUDoaLc39G"), locationId: z.string(), checkedAt: z.iso.datetime(),
  calendarSince: z.string(), qualificationConfigured: z.boolean(),
  contacts: z.array(z.object({
    id: z.string(), createdAt: z.iso.datetime().nullable(), leadAt: z.iso.datetime().nullable(), leadEvidence: z.enum(["submission", "form_origin", "tag", "none"]),
    attribution: z.object({ first: touch, latest: touch, firstConflict: z.boolean() }),
    qualified: z.boolean().nullable(), won: z.boolean().nullable(), booked: z.boolean(), attended: z.boolean(),
    customerIds: z.array(z.string()),
  })),
  charges: z.array(z.object({ id: z.string(), customerId: z.string().nullable(), contactId: z.string().nullable(), at: z.iso.datetime(), currency: z.string(), collected: z.number().int().nonnegative(), refunded: z.number().int().nonnegative(), failed: z.boolean() })),
  subscriptions: z.array(z.object({ id: z.string(), customerId: z.string(), contactId: z.string().nullable(), status: z.string(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime().nullable(), cancelScheduled: z.boolean() })),
  health: z.object({ unmatchedCustomers: z.number(), ambiguousCustomers: z.number(), unmappedAdContacts: z.number(), attributionConflicts: z.number(), unmatchedCharges: z.number() }),
});
export type JourneySnapshot = z.infer<typeof journeySnapshotSchema>;
type Row = Record<string, unknown>;
export type StripeReadSnapshot = { accountId: string; livemode: boolean; complete: boolean; checkedAt: string; customers: Row[]; charges: Row[]; subscriptions: Row[] };
export const UKTL_STRIPE_ACCOUNT = "acct_1OuZwXBUDoaLc39G";
export const UKTL_LOCATION = "IYjyc7Efk0yAOzpSO9FM";
export const UKTL_META_ACCOUNT = "act_1357893439073996";
const iso = (value: unknown): string | null => {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(String(value ?? ""));
  return Number.isFinite(+date) ? date.toISOString() : null;
};
const id = (value: unknown) => text(typeof value === "object" ? object(value).id : value);
const uniqueRows = (rows: Row[], key = "id") => {
  if (rows.some(r => !id(r[key])) || new Set(rows.map(r => id(r[key]))).size !== rows.length) throw new Error("Provider collection has missing or duplicate identifiers");
};

export function normalizeCustomerJourney(input: {
  locationId: string; contacts: Row[]; opportunities: Row[]; events: Row[]; payments: Row[]; stripe: StripeReadSnapshot;
  identities: MetaIdentity[]; formId: string; pipelineId: string; calendarSince: string;
  submissions?: Row[]; qualifiedStageIds?: string[]; qualifiedTag?: string; previous?: JourneySnapshot;
}): JourneySnapshot {
  if (input.locationId !== UKTL_LOCATION || input.stripe.accountId !== UKTL_STRIPE_ACCOUNT || !input.stripe.livemode || !input.stripe.complete) throw new Error("Verified UKTL provider scope and complete Stripe reads required");
  uniqueRows(input.contacts); uniqueRows(input.stripe.customers); uniqueRows(input.stripe.charges); uniqueRows(input.stripe.subscriptions);
  const contacts = input.contacts.filter(c => {
    if (c.locationId !== input.locationId) throw new Error("CRM location mismatch");
    return !Array.isArray(c.tags) || !c.tags.some(t => /^(uktl-tracking-test|.*onboarding-test.*)$/i.test(String(t)));
  });
  const contactIds = new Set(contacts.map(c => String(c.id)));
  const evidence: IdentityEvidence[] = [];
  for (const row of [...input.stripe.customers, ...input.stripe.charges, ...input.stripe.subscriptions]) {
    if (row.livemode !== true) throw new Error("Unexpected test-mode Stripe record");
    const metadata = object(row.metadata);
    // HighLevel's native Stripe metadata includes contactId + altId. Its
    // customer metadata instead uses id + location. Both require exact scope.
    const contactId = metadata.altId === input.locationId ? id(metadata.contactId)
      : metadata.location === input.locationId ? id(metadata.id) : null;
    const customerId = String(row.object === "customer" || String(row.id).startsWith("cus_") ? row.id : id(row.customer) ?? "");
    if (contactId) evidence.push({ customerId, contactId, evidence: "stripe_metadata" });
  }
  for (const payment of input.payments) {
    if (payment.altId !== input.locationId || payment.paymentProviderConnectedAccount !== UKTL_STRIPE_ACCOUNT || payment.liveMode !== true || payment.paymentProviderType !== "stripe") continue;
    // GHL chargeId is commonly a PaymentIntent ID; reconcile against Stripe,
    // never against a receipt name, amount or payment date.
    const charge = input.stripe.charges.find(c => c.id === payment.chargeId || id(c.payment_intent) === payment.chargeId);
    if (charge && id(charge.customer) && id(payment.contactId)) evidence.push({ customerId: id(charge.customer)!, contactId: id(payment.contactId)!, evidence: "ghl_payment_id" });
  }
  const resolved = resolveCustomerIdentities(evidence, contactIds);
  const previous = new Map(input.previous?.contacts.map(c => [c.id, c]) ?? []);
  const qualificationConfigured = Boolean(input.qualifiedStageIds?.length || input.qualifiedTag);
  const normalizedContacts = contacts.map(c => {
    const tags = Array.isArray(c.tags) ? c.tags : [];
    const first = object(c.attributionSource);
    const createdBy = object(c.createdBy);
    const formOrigin = (first.medium === "form" && first.mediumId === input.formId) || (createdBy.source === "FORM" && createdBy.sourceId === input.formId);
    const receipts = (input.submissions ?? []).filter(s => s.contactId === c.id).map(s => iso(s.createdAt)).filter((v): v is string => !!v).sort();
    const leadEvidence = receipts.length ? "submission" : formOrigin ? "form_origin" : tags.includes("new lead") ? "tag" : "none";
    const opportunities = input.opportunities.filter(o => (o.contactId ?? object(o.contact).id) === c.id);
    const appointments = input.events.filter(e => e.contactId === c.id && !e.deleted && !["cancelled", "canceled", "invalid"].includes(String(e.appointmentStatus)));
    const observed = previous.get(String(c.id));
    return {
      id: String(c.id), createdAt: iso(c.dateAdded), leadAt: receipts[0] ?? (leadEvidence !== "none" ? iso(c.dateAdded) : null), leadEvidence,
      attribution: preserveAttribution(c, input.identities, previous.get(String(c.id))?.attribution),
      // These are witnessed journey milestones, not a replacement for current
      // CRM state. Progressing or removing a tag cannot erase an observed step.
      qualified: qualificationConfigured ? observed?.qualified === true || tags.includes(input.qualifiedTag) || opportunities.some(o => o.pipelineId === input.pipelineId && input.qualifiedStageIds?.includes(String(o.pipelineStageId))) : null,
      won: observed?.won === true || opportunities.some(o => o.pipelineId === input.pipelineId && o.status === "won") ? true : opportunities.length ? false : null,
      booked: observed?.booked === true || appointments.length > 0, attended: observed?.attended === true || appointments.some(e => e.appointmentStatus === "showed"),
      customerIds: [...resolved.matched].filter(([, contactId]) => contactId === c.id).map(([customerId]) => customerId),
    };
  });
  const charges = input.stripe.charges.map(c => {
    const at = iso(c.created), currency = text(c.currency)?.toUpperCase();
    if (!at || !/^[A-Z]{3}$/.test(currency ?? "")) throw new Error("Stripe payment date/currency unavailable");
    const collected = c.status === "succeeded" && c.paid === true && c.captured === true ? c.amount_captured : 0;
    const providerRefund = c.amount_refunded;
    if (!Number.isSafeInteger(collected) || Number(collected) < 0 || !Number.isSafeInteger(providerRefund) || Number(providerRefund) < 0
      || !Number.isSafeInteger(c.amount) || Number(providerRefund) > Number(c.amount)) throw new Error("Stripe payment amount unavailable");
    // Stripe also labels released card authorisations as refunded. Money that
    // was never captured is neither collected revenue nor a cash refund.
    const refunded = Math.min(Number(providerRefund), Number(collected));
    const customerId = id(c.customer);
    return { id: String(c.id), customerId, contactId: customerId ? resolved.matched.get(customerId) ?? null : null, at, currency: currency!, collected: Number(collected), refunded: Number(refunded), failed: c.status === "failed" };
  });
  const subscriptions = input.stripe.subscriptions.map(s => {
    const customerId = id(s.customer), startedAt = iso(s.start_date ?? s.created);
    if (!customerId || !startedAt || !text(s.status)) throw new Error("Stripe subscription identity unavailable");
    // canceled_at can be the request date while service is still active.
    // Only ended_at establishes the end of this subscription.
    return { id: String(s.id), customerId, contactId: resolved.matched.get(customerId) ?? null, status: String(s.status), startedAt, endedAt: iso(s.ended_at), cancelScheduled: s.cancel_at_period_end === true || Boolean(s.cancel_at) };
  });
  return journeySnapshotSchema.parse({
    version: 1, accountId: UKTL_STRIPE_ACCOUNT, locationId: input.locationId, checkedAt: input.stripe.checkedAt,
    calendarSince: input.calendarSince, qualificationConfigured, contacts: normalizedContacts, charges, subscriptions,
    health: {
      unmatchedCustomers: input.stripe.customers.filter(c => !resolved.matched.has(String(c.id)) && !resolved.ambiguous.has(String(c.id))).length,
      ambiguousCustomers: resolved.ambiguous.size,
      unmappedAdContacts: normalizedContacts.filter(c => c.attribution.first.paidMeta && !c.attribution.first.adId).length,
      attributionConflicts: normalizedContacts.filter(c => c.attribution.firstConflict || c.attribution.latest.hierarchyConflict).length,
      unmatchedCharges: charges.filter(c => !c.contactId).length,
    },
  });
}
