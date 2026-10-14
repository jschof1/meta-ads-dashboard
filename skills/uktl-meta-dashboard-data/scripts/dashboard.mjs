#!/usr/bin/env node
// Portable saved-data reader. Authentication is the only dashboard POST.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
class SafeError extends Error {}

export const BASE = 'https://uktl-meta-dashboard.jackschofield1.workers.dev';
export const LINKS = {
  dashboard: BASE + '/',
  github: 'https://github.com/jschof1/meta-ads-dashboard',
  skill: 'https://github.com/jschof1/meta-ads-dashboard/tree/codex/uktl-dashboard-data-skill/skills/uktl-meta-dashboard-data',
  cloudflare: 'https://dash.cloudflare.com/',
  worker: 'uktl-meta-dashboard',
  database: 'Turso/libSQL: uktl-meta-dashboard',
};
const PERIODS = {
  today: ['today', 'yesterday'],
  '7d': ['last7', 'previous7'],
  '14d': ['last14', 'previous14'],
  '30d': ['last30', 'previous30'],
  mtd: ['mtd', 'previousMtd'],
};
const HELP = `UKTL dashboard reader (Node 20+, no npm install)
  node dashboard.mjs links
  node dashboard.mjs status [--period 7d|14d|30d|mtd|today]
  node dashboard.mjs ads [--period 7d] [--active-only]
  node dashboard.mjs enquiries [--days 30] [--details]
  node dashboard.mjs quota
Options: --config /private/config.json, --out /private/report.json,
         --format json|csv (CSV: ads, or enquiries --details)
Saved reads need DASHBOARD_PASSWORD in a private config file, or
UKTL_DASHBOARD_PASSWORD in the process environment. The default file is
~/.config/uktl-meta-dashboard/production.json. Quota additionally needs
HIGHLEVEL_TOKEN and HIGHLEVEL_LOCATION_ID. No provider refresh is performed.`;

export function parseOptions(argv) {
  const options = { command: argv[0] || 'status', period: '7d', days: 30, format: 'json' };
  if (['--help', '-h', 'help'].includes(options.command)) return { help: true };
  if (!['links', 'status', 'ads', 'enquiries', 'quota'].includes(options.command)) throw new SafeError('Unknown command; use --help');
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--details') options.details = true;
    else if (flag === '--active-only') options.activeOnly = true;
    else if (['--period', '--days', '--config', '--out', '--format'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new SafeError('Missing option value');
      options[flag.slice(2)] = flag === '--days' ? Number(value) : value;
    } else throw new SafeError('Unknown option; use --help');
  }
  if (!PERIODS[options.period]) throw new SafeError('Period must be today, 7d, 14d, 30d or mtd');
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 365) throw new SafeError('Days must be an integer from 1 to 365');
  if (!['json', 'csv'].includes(options.format)) throw new SafeError('Format must be json or csv');
  if (options.details && options.command !== 'enquiries') throw new SafeError('--details is only for enquiries');
  if (options.activeOnly && options.command !== 'ads') throw new SafeError('--active-only is only for ads');
  if (options.format === 'csv' && !(options.command === 'ads' || options.command === 'enquiries' && options.details)) throw new SafeError('CSV requires ads, or enquiries --details');
  return options;
}

export function loadConfig(options, env = process.env) {
  const filename = options.config || env.UKTL_DASHBOARD_CONFIG || path.join(os.homedir(), '.config/uktl-meta-dashboard/production.json');
  let config = {};
  if (fs.existsSync(filename)) {
    const stat = fs.statSync(filename);
    if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) throw new SafeError('Credential file must be owned by you and have no group/world access (chmod 600)');
    try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch { throw new SafeError('Credential file must contain valid JSON'); }
  } else if (options.config || env.UKTL_DASHBOARD_CONFIG) throw new SafeError('Credential file unavailable');
  if (env.UKTL_DASHBOARD_PASSWORD) config.DASHBOARD_PASSWORD = env.UKTL_DASHBOARD_PASSWORD;
  if (!config.DASHBOARD_PASSWORD) throw new SafeError('Dashboard password unavailable; use the secret helper or a private config file');
  return config;
}

export async function connect(config, fetcher = fetch) {
  const request = async (route, init = {}) => {
    let response;
    try { response = await fetcher(BASE + route, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30000) }); }
    catch { throw new SafeError('Dashboard request failed or timed out'); }
    if (!response.ok) throw new SafeError(`Dashboard ${route} HTTP ${response.status}; no retry attempted`);
    return response;
  };
  const login = await request('/api/auth', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: config.DASHBOARD_PASSWORD }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new SafeError('Dashboard session unavailable');
  return async (route) => {
    if (!['/api/dashboard/state', '/api/lead-register', '/api/diagnostics'].includes(route)) throw new SafeError('Unsupported saved-data route');
    const response = await request(route, { headers: { Cookie: cookie } });
    try { const value = await response.json(); return value.data ?? value; }
    catch { throw new SafeError('Dashboard returned invalid JSON'); }
  };
}

export function registerSummary(register, days = 30, details = false, now = new Date()) {
  if (!register) return { status: 'unavailable', savedAt: null, counts: null };
  const end = Date.parse(register.checkedAt);
  if (!Number.isFinite(end) || !Array.isArray(register.entries)) throw new SafeError('Saved register is malformed');
  const start = end - days * 86400000;
  const recent = (value) => Date.parse(value) >= start && Date.parse(value) <= end;
  const real = register.entries.filter(e => !e.test && !(e.tags || []).some(t => t.trim().toLowerCase() === 'uktl-tracking-test'));
  const receipts = new Map(real.flatMap(e => (e.submissions || []).filter(s => recent(s.at)).map(s => [s.id, s])));
  const appointments = new Map(real.flatMap(e => (e.appointments || []).filter(a => recent(a.at)).map(a => [a.id, a])));
  const people = real.filter(e => (e.submissions || []).some(s => recent(s.at)));
  const created = real.filter(e => recent(e.contactCreated));
  const gap = created.filter(e => e.formOrigin && !(e.submissions || []).some(s => recent(s.at)));
  const expected = new Date(now); expected.setUTCMinutes(45, 0, 0);
  if (+expected > +now) expected.setUTCHours(expected.getUTCHours() - 1);
  const overdue = +now - +expected > 10 * 60000 && end < +expected;
  const result = {
    status: overdue ? 'schedule_overdue' : 'saved', savedAt: register.checkedAt,
    ageMinutes: Math.round((+now - end) / 60000),
    latestExpectedScheduleAt: expected.toISOString(), scheduleOverdue: overdue,
    window: { since: new Date(start).toISOString(), until: register.checkedAt, days, anchoredTo: 'saved register timestamp' },
    coverageStart: register.coverageStart ?? null,
    counts: { savedContactsAllTime: register.entries.length, excludedTestContacts: register.entries.length - real.length,
      contactsCreated: created.length, formPeople: people.length, formReceipts: receipts.size,
      formAttributedWithoutReceipt: gap.length, appointments: appointments.size,
      confirmed: [...appointments.values()].filter(a => a.status === 'confirmed').length,
      cancelled: [...appointments.values()].filter(a => a.status === 'cancelled').length },
  };
  if (details) result.rows = real.filter(e => recent(e.contactCreated) || (e.submissions || []).some(s => recent(s.at)) || (e.appointments || []).some(a => recent(a.at))).map(e => ({
    contactId: e.contactId, name: e.name, createdAt: e.contactCreated, source: e.source,
    formOrigin: Boolean(e.formOrigin), formReceipts: (e.submissions || []).filter(s => recent(s.at)).length,
    appointments: (e.appointments || []).filter(a => recent(a.at)).length,
    lastConversationAt: e.lastConversationAt || null, checkedAt: e.checkedAt || null,
  }));
  return result;
}

export function adsSummary(state, period = '7d', activeOnly = false) {
  if (!state?.meta || !state.scorecard || !Array.isArray(state.ads)) throw new SafeError('Saved dashboard state is malformed');
  const [current, previous] = PERIODS[period];
  const comparable = period !== 'mtd' || state.meta.mtdComparisonComparable === true;
  const rows = state.ads.filter(ad => !activeOnly || ad.status === 'ACTIVE').map(ad => ({
    adId: ad.adId, adName: ad.adName, status: ad.status, metadataCurrent: ad.isCurrent ?? null,
    campaignId: ad.campaignId, adSetId: ad.adSetId, period,
    currency: state.meta.currencyCode ?? null, lastSuccessfulSyncAt: state.meta.lastSuccessfulSyncAt ?? state.meta.lastSyncAt ?? null,
    ...(ad.periods?.[current] || { spendCents: null, leads: null, cplCents: null }),
    evidenceStatus: ad.evidence?.[period]?.status ?? 'unknown',
  }));
  rows.sort((a, b) => (b.spendCents ?? -1) - (a.spendCents ?? -1));
  return {
    source: 'saved dashboard; no live Meta read', period, periodDefinition: 'Account-local calendar days, including today; today may be incomplete',
    meta: { accountId: state.meta.adAccountId, currency: state.meta.currencyCode, timezone: state.meta.timezoneName,
      syncState: state.meta.syncState, lastSuccessfulSyncAt: state.meta.lastSuccessfulSyncAt ?? state.meta.lastSyncAt ?? null,
      lastAttemptAt: state.meta.lastAttemptAt, lastAttemptStatus: state.meta.lastAttemptStatus,
      metadataStaleCount: state.meta.metadataStaleCount ?? null },
    totals: state.scorecard[current] ?? null,
    comparison: { comparable, bucket: previous, totals: comparable ? state.scorecard[previous] ?? null : null },
    warnings: state.dataWarnings?.[period] ?? [],
    counts: { allAds: state.ads.length, activeAds: state.ads.filter(ad => ad.status === 'ACTIVE').length, returnedAds: rows.length },
    rows,
  };
}

export async function quotaProbe(config, fetcher = fetch) {
  if (!config.HIGHLEVEL_TOKEN || !config.HIGHLEVEL_LOCATION_ID) return { status: 'not_configured', dailyRemaining: null };
  let response;
  try { response = await fetcher('https://services.leadconnectorhq.com/contacts/?' + new URLSearchParams({ locationId: config.HIGHLEVEL_LOCATION_ID, limit: '1' }), {
    headers: { Authorization: `Bearer ${config.HIGHLEVEL_TOKEN}`, Version: config.HIGHLEVEL_API_VERSION || '2021-07-28' },
    redirect: 'manual', signal: AbortSignal.timeout(15000),
  }); } catch { return { status: 'network_failure', dailyRemaining: null }; }
  const numeric = (key) => { const value = response.headers.get(key); return value !== null && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null; };
  const dailyRemaining = numeric('x-ratelimit-daily-remaining');
  // Discard contact body: the quota command never returns provider personal data.
  await response.arrayBuffer();
  return { status: dailyRemaining === 0 ? 'daily_quota_exhausted' : response.ok ? 'available' : response.status === 429 ? dailyRemaining > 0 ? 'short_rate_limited' : 'rate_limited' : 'provider_unavailable',
    httpStatus: response.status, dailyRemaining, shortRemaining: numeric('x-ratelimit-remaining'),
    intervalMs: numeric('x-ratelimit-interval-milliseconds'), providerComparisonPerformed: false };
}

export function csv(rows) {
  if (!rows.length) return 'no_rows\n';
  const keys = Object.keys(rows[0]);
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [keys.map(cell).join(','), ...rows.map(row => keys.map(key => cell(row[key])).join(','))].join('\n') + '\n';
}

export async function run(options, config, fetcher = fetch, now = new Date()) {
  if (options.command === 'links') return LINKS;
  const get = await connect(config, fetcher);
  if (options.command === 'ads') return { observedAt: now.toISOString(), ...adsSummary(await get('/api/dashboard/state'), options.period, options.activeOnly) };
  if (options.command === 'enquiries') return { observedAt: now.toISOString(), ...registerSummary(await get('/api/lead-register'), options.days, options.details, now) };
  if (options.command === 'quota') {
    const register = registerSummary(await get('/api/lead-register'), options.days, false, now);
    return { observedAt: now.toISOString(), register, quota: await quotaProbe(config, fetcher) };
  }
  const [state, register, diagnostics] = await Promise.all([
    get('/api/dashboard/state'), get('/api/lead-register'), get('/api/diagnostics'),
  ]);
  const ads = adsSummary(state, options.period);
  return { observedAt: now.toISOString(), links: LINKS,
    meta: ads.meta, adCounts: ads.counts, period: ads.period, totals: ads.totals, comparison: ads.comparison, warnings: ads.warnings,
    register: registerSummary(register, options.days, false, now),
    diagnostics: { checkedAt: diagnostics.checkedAt, database: diagnostics.database?.status ?? 'unknown',
      migrations: diagnostics.migrations?.status ?? 'unknown', meta: diagnostics.meta?.status ?? 'unknown',
      highLevelConfiguration: diagnostics.highLevel?.status ?? 'unknown' },
    stageBasedCrm: { status: state.crm?.status ?? 'unknown', syncEnabled: state.crm?.syncEnabled ?? null,
      lastSuccessfulSyncAt: state.crm?.lastSyncAt ?? null, dataQuality: state.crm?.dataQuality ?? 'unknown' },
    limits: ['Saved reads do not prove current provider parity.', 'Meta Lead events, unique form people, receipts and bookings are different units.', 'Booking status does not prove attendance or payment.'],
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  const result = await run(options, options.command === 'links' ? {} : loadConfig(options));
  const output = options.format === 'csv' ? csv(result.rows) : JSON.stringify(result, null, 2) + '\n';
  if (options.out) {
    fs.writeFileSync(options.out, output, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ written: path.resolve(options.out), format: options.format, containsContactDetails: Boolean(options.details) }));
  } else process.stdout.write(output);
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof SafeError ? error.message : error?.code === 'EEXIST' ? 'Output already exists; choose a new filename' : 'Unable to read or write dashboard data; check access and configuration');
    process.exitCode = 1;
  });
}
