// Generic, provider-neutral UKTL funnel logic. A future CRM adapter can map
// provider stages into this shape without changing the dashboard vocabulary.

export type FunnelRow = {
  email: string;
  firstName?: string;
  leadTime?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  stage?: string;
};

export type FunnelCounts = {
  leads: number;
  contacted: number;
  qualified: number;
  callsBooked: number;
  callsAttended: number;
  wonCustomers: number;
  lostCustomers: number;
  metaPixelLeads?: number;
  testEmailsExcluded: number;
  duplicatesCollapsed: number;
};

const TEST_EMAILS = new Set<string>();
const TEST_SUBSTRINGS = ["+test"];

const STATUS_RANK: Record<string, number> = {
  lead: 10,
  contacted: 20,
  qualified: 30,
  "call booked": 40,
  "call attended": 50,
  show: 50,
  "won customer": 60,
  won: 60,
  lost: 5,
};

function normaliseStage(stage: string | undefined): string {
  return (stage || "").trim().toLowerCase();
}

function rank(stage: string | undefined): number {
  return STATUS_RANK[normaliseStage(stage)] ?? 0;
}

export function isTestEmail(rawEmail: string | undefined | null): boolean {
  if (!rawEmail) return true;
  const email = rawEmail.trim().toLowerCase();
  return TEST_EMAILS.has(email) || TEST_SUBSTRINGS.some((part) => email.includes(part));
}

export function normalizeEmail(rawEmail: string | undefined | null): string {
  return (rawEmail || "").trim().toLowerCase();
}

function pickBest(left: FunnelRow, right: FunnelRow): FunnelRow {
  const leftRank = rank(left.stage);
  const rightRank = rank(right.stage);
  if (leftRank !== rightRank) return leftRank > rightRank ? left : right;
  const leftTime = left.leadTime ? Date.parse(left.leadTime) : 0;
  const rightTime = right.leadTime ? Date.parse(right.leadTime) : 0;
  return leftTime >= rightTime ? left : right;
}

function merge(left: FunnelRow, right: FunnelRow): FunnelRow {
  const best = pickBest(left, right);
  return {
    email: left.email,
    firstName: left.firstName || right.firstName,
    leadTime: left.leadTime || right.leadTime,
    utmSource: left.utmSource || right.utmSource,
    utmMedium: left.utmMedium || right.utmMedium,
    utmCampaign: left.utmCampaign || right.utmCampaign,
    stage: best.stage,
  };
}

export function dedupe(rows: FunnelRow[]): { rows: FunnelRow[]; collapsed: number } {
  const byEmail = new Map<string, FunnelRow>();
  let collapsed = 0;
  for (const row of rows) {
    const email = normalizeEmail(row.email);
    if (!email) continue;
    const existing = byEmail.get(email);
    if (existing) {
      collapsed += 1;
      byEmail.set(email, merge(existing, { ...row, email }));
    } else {
      byEmail.set(email, { ...row, email });
    }
  }
  return { rows: Array.from(byEmail.values()), collapsed };
}

export function filterTest(rows: FunnelRow[]): { rows: FunnelRow[]; excluded: number } {
  const kept: FunnelRow[] = [];
  let excluded = 0;
  for (const row of rows) {
    if (isTestEmail(row.email)) excluded += 1;
    else kept.push(row);
  }
  return { rows: kept, excluded };
}

export function isPaidMeta(row: FunnelRow): boolean {
  const source = (row.utmSource || "").toLowerCase();
  const medium = (row.utmMedium || "").toLowerCase();
  return source === "meta" || medium === "paid_social";
}

export function rollup(rows: FunnelRow[]): Omit<FunnelCounts, "metaPixelLeads" | "testEmailsExcluded" | "duplicatesCollapsed"> {
  const counts = {
    leads: rows.length,
    contacted: 0,
    qualified: 0,
    callsBooked: 0,
    callsAttended: 0,
    wonCustomers: 0,
    lostCustomers: 0,
  };
  for (const row of rows) {
    const stage = normaliseStage(row.stage);
    const value = rank(stage);
    if (value >= STATUS_RANK.contacted) counts.contacted += 1;
    if (value >= STATUS_RANK.qualified) counts.qualified += 1;
    if (value >= STATUS_RANK["call booked"]) counts.callsBooked += 1;
    if (value >= STATUS_RANK["call attended"]) counts.callsAttended += 1;
    if (value >= STATUS_RANK.won) counts.wonCustomers += 1;
    if (stage === "lost") counts.lostCustomers += 1;
  }
  return counts;
}

export function buildFunnel(rawRows: FunnelRow[], options?: { metaPixelLeads?: number }): { counts: FunnelCounts; rows: FunnelRow[] } {
  const filtered = filterTest(rawRows);
  const clean = dedupe(filtered.rows);
  return {
    counts: {
      ...rollup(clean.rows),
      metaPixelLeads: options?.metaPixelLeads,
      testEmailsExcluded: filtered.excluded,
      duplicatesCollapsed: clean.collapsed,
    },
    rows: clean.rows,
  };
}
