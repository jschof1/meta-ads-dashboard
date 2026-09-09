import { createHighLevelClient } from "@/lib/highlevel";
import { loadHighLevelSettings } from "@/lib/highlevel-config";
import { prisma, withDatabaseClient } from "@/lib/db";

type Row = Record<string, unknown>;
const str = (v: unknown) => typeof v === "string" ? v : "";
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const validId = (v: unknown): v is string => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
export type LeadEntry = {
  contactId: string; name: string; contactFound: boolean; contactCreated: string;
  lastConversationAt: string; lastMessageChannel: string;
  source: string; tags: string[]; test: boolean; metaSource: string;
  submissions: { id: string; at: string; page: string; source: string }[];
  appointments: { id: string; at: string; status: string }[];
  checkedAt: string;
};
export type LeadRegister = { locationId?: string; checkedAt: string; coverageStart: string; calendarEnd: string; entries: LeadEntry[] };

// Provider contact IDs, not names or submission counts, define a person here.
export function reconcileLeads(contacts: Row[], submissions: Row[], events: Row[], start: Date, now: Date, calendarEnd: Date, conversations: Row[] = []): LeadRegister {
  const contactMap = new Map(contacts.map(c => [str(c.id), c]));
  if (contactMap.size !== contacts.length || contacts.some(c => !validId(c.id))) throw new Error("Contact collection inconsistent");
  const selected = new Set(contacts.filter(c => Date.parse(str(c.dateAdded)) >= +start && Date.parse(str(c.dateAdded)) <= +now).map(c => str(c.id)));
  const conversationMap = new Map<string, Row>();
  for (const c of conversations) {
    if (!validId(c.contactId) || typeof c.lastMessageDate !== "number") continue;
    if(c.lastMessageDate < +start || c.lastMessageDate > +now) continue;
    selected.add(c.contactId);
    if(Number(conversationMap.get(c.contactId)?.lastMessageDate || 0) < c.lastMessageDate) conversationMap.set(c.contactId,c);
  }
  const grouped = new Map<string, LeadEntry["submissions"]>();
  const ids = new Set<string>();
  for (const s of submissions) {
    if (!validId(s.id) || !validId(s.contactId) || !Number.isFinite(Date.parse(str(s.createdAt))) || ids.has(s.id)) throw new Error("Submission collection inconsistent");
    ids.add(s.id);
    if (Date.parse(str(s.createdAt)) < +start || Date.parse(str(s.createdAt)) > +now) continue;
    selected.add(s.contactId);
    const other = obj(s.others), event = obj(other.eventData), params = obj(event.url_params);
    const rows = grouped.get(s.contactId) ?? [];
    rows.push({ id: s.id, at: str(s.createdAt), page: str(obj(other.funneEventData).page_url).slice(0,200), source: str(params.utm_source).slice(0,100) });
    grouped.set(s.contactId, rows);
  }
  const entries = [...selected].map(contactId => {
    const c = contactMap.get(contactId), tags = Array.isArray(c?.tags) ? c.tags.filter((t): t is string => typeof t === "string").map(t => t.slice(0,100)) : [];
    const own = grouped.get(contactId) ?? [];
    const conversation=conversationMap.get(contactId);
    return { contactId, name: str(c?.contactName) || [str(c?.firstName),str(c?.lastName)].filter(Boolean).join(" ") || "Contact unavailable",
      lastConversationAt: conversation ? new Date(Number(conversation.lastMessageDate)).toISOString() : "", lastMessageChannel: str(conversation?.lastMessageType).replace("TYPE_", ""),
      contactFound: !!c, contactCreated: str(c?.dateAdded), source: str(c?.source).slice(0,200) || "Unspecified", tags,
      test: tags.includes("uktl-tracking-test"), metaSource: own.find(s => /^(fb|ig|facebook|instagram)$/i.test(s.source))?.source || str(obj(c?.attributionSource).utmSource).slice(0,100),
      submissions: own.sort((a,b) => a.at.localeCompare(b.at)),
      appointments: events.filter(e => e.contactId === contactId && !e.deleted && Date.parse(str(e.startTime)) >= +start && Date.parse(str(e.startTime)) <= +calendarEnd).map(e => ({ id: str(e.id), at: str(e.startTime), status: str(e.appointmentStatus) || "unknown" })), checkedAt: now.toISOString(),
    };
  });
  return { checkedAt: now.toISOString(), coverageStart: start.toISOString(), calendarEnd: calendarEnd.toISOString(), entries };
}

export function mergeRegister(previous: LeadRegister | null, fresh: LeadRegister): LeadRegister {
  if (previous && previous.checkedAt > fresh.checkedAt) return previous;
  const map = new Map(previous?.entries.map(e => [e.contactId,e]) ?? []);
  for (const entry of fresh.entries) {
    const old = map.get(entry.contactId);
    // Preserve previously observed submissions when the rolling provider window advances.
    const submissions = new Map(old?.submissions.map(s => [s.id,s]) ?? []);
    entry.submissions.forEach(s => submissions.set(s.id,s));
    map.set(entry.contactId, { ...entry, submissions: [...submissions.values()].sort((a,b)=>a.at.localeCompare(b.at)) });
  }
  return { ...fresh, coverageStart: previous && previous.coverageStart < fresh.coverageStart ? previous.coverageStart : fresh.coverageStart, entries: [...map.values()] };
}

export async function fetchLeadRegister(now = new Date()): Promise<LeadRegister> {
  const config = loadHighLevelSettings();
  const formId = process.env.HIGHLEVEL_LEAD_FORM_ID, calendarId = process.env.HIGHLEVEL_SALES_CALENDAR_ID;
  if (!config.token || !validId(config.locationId) || !validId(formId) || !validId(calendarId)) throw new Error("Lead register connection unavailable");
  const start = new Date(+now - 90 * 86400000), calendarEnd = new Date(+now + 90 * 86400000);
  async function read(path: string): Promise<Row> {
    const r = await fetch(`https://services.leadconnectorhq.com${path}`, { headers: { Authorization: `Bearer ${config.token}`, Version: config.apiVersion }, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error("Lead register provider unavailable");
    return r.json();
  }
  async function submissions() {
    const rows: Row[] = [];
    for (let page=1; page<=Math.ceil(config.maxRecords/100);page++) {
      const q = new URLSearchParams({locationId:config.locationId!,formId:formId!,startAt:start.toISOString().slice(0,10),endAt:now.toISOString().slice(0,10),limit:"100",page:String(page)});
      const d=await read(`/forms/submissions?${q}`), meta=obj(d.meta);
      if (!Array.isArray(d.submissions) || typeof meta.total !== "number") throw new Error("Submission collection incomplete");
      rows.push(...d.submissions as Row[]);
      if (!meta.nextPage) { if(rows.length!==meta.total) throw new Error("Submission collection incomplete"); return rows; }
      if(!d.submissions.length) throw new Error("Submission pagination stalled");
    }
    throw new Error("Submission collection exceeds limit");
  }
  async function conversations() {
    const rows: Row[]=[]; const seen=new Set<string>(); let cursor="";
    for(let page=0;page<Math.ceil(config.maxRecords/100);page++) {
      const q=new URLSearchParams({locationId:config.locationId!,limit:"100",sort:"desc",sortBy:"last_message_date"});
      if(cursor)q.set("startAfterDate",cursor);
      const d=await read(`/conversations/search?${q}`);
      if(!Array.isArray(d.conversations))throw new Error("Conversation collection incomplete");
      const items=d.conversations as Row[];
      if(!items.length)return rows;
      for(const item of items){if(!validId(item.id)||seen.has(item.id))throw new Error("Conversation pagination inconsistent");seen.add(item.id);rows.push(item);}
      const last=items.at(-1)!;
      if(typeof last.lastMessageDate!=="number")throw new Error("Conversation date unavailable");
      if(last.lastMessageDate < +start || items.length<100 || rows.length===d.total)return rows;
      const next=String(last.lastMessageDate);if(next===cursor)throw new Error("Conversation pagination stalled");cursor=next;
    }
    throw new Error("Conversation collection exceeds limit");
  }
  const [contacts, forms, calendar, inbox] = await Promise.all([createHighLevelClient({config}).listContacts(), submissions(), read(`/calendars/events?${new URLSearchParams({locationId:config.locationId,calendarId,startTime:String(+start),endTime:String(+calendarEnd)})}`), conversations()]);
  if(contacts.truncated || !Array.isArray(calendar.events)) throw new Error("Lead register collection incomplete");
  return { ...reconcileLeads(contacts.items,forms,calendar.events as Row[],start,now,calendarEnd,inbox), locationId: config.locationId };
}

export async function readLeadRegister(): Promise<LeadRegister | null> {
  const locationId=process.env.HIGHLEVEL_LOCATION_ID;
  if(!validId(locationId)) throw new Error("Lead register location unavailable");
  return withDatabaseClient(prisma,async client=>{
    const result=await client.execute({sql:'SELECT payload FROM LeadRegisterSnapshot WHERE locationId = ?',args:[locationId]});
    return result.rows[0] ? JSON.parse(String(result.rows[0].payload)) as LeadRegister : null;
  });
}
export async function syncLeadRegister() {
  const fresh=await fetchLeadRegister(),locationId=process.env.HIGHLEVEL_LOCATION_ID!;
  return withDatabaseClient(prisma,async client=>{
    const tx=await client.transaction("write");
    try {
      const rows=await tx.execute({sql:'SELECT payload FROM LeadRegisterSnapshot WHERE locationId = ?',args:[locationId]});
      const previous=rows.rows[0]?JSON.parse(String(rows.rows[0].payload)) as LeadRegister:null;
      const data=mergeRegister(previous,fresh);
      await tx.execute({sql:'INSERT INTO LeadRegisterSnapshot(locationId,payload,checkedAt) VALUES(?,?,?) ON CONFLICT(locationId) DO UPDATE SET payload=excluded.payload,checkedAt=excluded.checkedAt',args:[locationId,JSON.stringify(data),data.checkedAt]});
      await tx.commit(); return data;
    } catch(error){await tx.rollback();throw error;}finally{tx.close();}
  });
}
