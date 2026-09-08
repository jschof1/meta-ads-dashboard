import { createHighLevelClient } from "@/lib/highlevel";
import { loadHighLevelSettings } from "@/lib/highlevel-config";

type Row = Record<string, unknown>;
const text = (v: unknown) => typeof v === "string" ? v : "";
const date = (v: unknown) => Date.parse(text(v));
export function summarizeBusinessOutcomes(contacts: Row[], events: Row[], payments: Row[], start: Date, end: Date) {
  const within = (value: unknown) => date(value) >= +start && date(value) <= +end;
  const leads = contacts.filter(c => within(c.dateAdded));
  const contacted = (c: Row) => Array.isArray(c.tags) && c.tags.some(t => text(t).trim().toLowerCase() === "contacted");
  const appointments = events.filter(e => !e.deleted && within(e.startTime));
  const bookedIds = new Set(appointments.map(e => text(e.contactId)).filter(Boolean));
  const paid = payments.filter(p => p.liveMode === true && p.paymentProviderType === "stripe" && ["succeeded", "refunded"].includes(text(p.status)) && within(p.createdAt));
  const currencyGroups: Record<string, { collected: number; refunded: number; net: number; payments: number }> = {};
  for (const p of paid) {
    if (typeof p.amount !== "number" || !Number.isFinite(p.amount) || typeof p.amountRefunded !== "number" || !Number.isFinite(p.amountRefunded)) throw new Error("Payment amounts unavailable");
    const currency = text(p.currency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Payment currency unavailable");
    const g = currencyGroups[currency] ??= { collected: 0, refunded: 0, net: 0, payments: 0 };
    g.collected += p.amount; g.refunded += p.amountRefunded; g.net += p.amount - p.amountRefunded; g.payments++;
  }
  const metaLeads = leads.filter(c => {
    const a = c.attributionSource as Row | undefined;
    return ["fb", "ig", "facebook", "instagram"].includes(text(a?.utmSource).toLowerCase());
  });
  return {
    checkedAt: end.toISOString(), windowStart: start.toISOString(), windowEnd: end.toISOString(),
    contactsCreated: leads.length, contactedNewContacts: leads.filter(contacted).length,
    appointments: appointments.length, uniqueBookers: bookedIds.size,
    appointmentStatuses: appointments.reduce<Record<string, number>>((acc, e) => { const s = text(e.appointmentStatus) || "unknown"; acc[s] = (acc[s] || 0) + 1; return acc; }, {}),
    metaSourcedContacts: metaLeads.length,
    metaContactsBooked: metaLeads.filter(c => bookedIds.has(text(c.id))).length,
    metaContactsContacted: metaLeads.filter(contacted).length,
    payments: paid.length, currencyGroups,
  };
}

export async function readBusinessOutcomes(now = new Date()) {
  const config = loadHighLevelSettings();
  const calendarId = process.env.HIGHLEVEL_SALES_CALENDAR_ID;
  if (!config.token || !config.locationId || !calendarId || !/^[A-Za-z0-9_-]+$/.test(calendarId)) throw new Error("Reporting connection unavailable");
  const start = new Date(+now - 30 * 86400_000);
  const client = createHighLevelClient({ config });
  async function read(path: string): Promise<Row> {
    const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Version: config.apiVersion },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Reporting provider returned ${response.status}`);
    return response.json();
  }
  async function transactions() {
    const rows: Row[] = [];
    for (let offset = 0; offset < config.maxRecords; offset += 100) {
      const result = await read(`/payments/transactions?altId=${encodeURIComponent(config.locationId!)}&altType=location&limit=100&offset=${offset}`);
      if (!Array.isArray(result.data) || typeof result.totalCount !== "number") throw new Error("Payment collection incomplete");
      rows.push(...result.data as Row[]);
      if (rows.length >= result.totalCount) {
        if (rows.length !== result.totalCount || new Set(rows.map(r => r._id)).size !== rows.length) throw new Error("Payment collection inconsistent");
        return rows;
      }
      if (result.data.length < 100) throw new Error("Payment collection incomplete");
    }
    throw new Error("Payment collection exceeds reporting limit");
  }
  const [contacts, calendar, payments] = await Promise.all([
    client.listContacts(),
    read(`/calendars/events?locationId=${encodeURIComponent(config.locationId)}&calendarId=${encodeURIComponent(calendarId)}&startTime=${+start}&endTime=${+now}`),
    transactions(),
  ]);
  if (contacts.truncated || new Set(contacts.items.map(c => c.id)).size !== contacts.items.length || !Array.isArray(calendar.events)) throw new Error("Reporting collection incomplete");
  return summarizeBusinessOutcomes(contacts.items, calendar.events as Row[], payments, start, now);
}
