import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseOptions, registerSummary, adsSummary, connect, run, csv } from './dashboard.mjs';

const now = new Date('2026-10-14T14:10:00Z');
const register = { checkedAt: '2026-10-14T13:45:59Z', coverageStart: '2026-09-01T00:00:00Z', entries: [
  { contactId: 'a', name: 'A', contactCreated: '2026-10-13T10:00:00Z', formOrigin: true, submissions: [{ id: 's1', at: '2026-10-13T10:00:00Z' }, { id: 's2', at: '2026-10-14T10:00:00Z' }], appointments: [{ id: 'e1', at: '2026-10-14T11:00:00Z', status: 'confirmed' }] },
  { contactId: 'b', name: 'B', contactCreated: '2026-10-13T11:00:00Z', formOrigin: true, submissions: [], appointments: [] },
  { contactId: 'test', name: 'Excluded', test: true, contactCreated: '2026-10-14T10:00:00Z', submissions: [{ id: 'test-s', at: '2026-10-14T10:00:00Z' }] },
] };

test('register separates people, receipts, contacts and receipt gaps; default hides names', () => {
  const result = registerSummary(register, 30, false, now);
  assert.equal(result.counts.formPeople, 1);
  assert.equal(result.counts.formReceipts, 2);
  assert.equal(result.counts.contactsCreated, 2);
  assert.equal(result.counts.formAttributedWithoutReceipt, 1);
  assert.equal(result.counts.appointments, 1);
  assert.equal(result.scheduleOverdue, false);
  assert.equal('rows' in result, false);
  assert.equal(JSON.stringify(result).includes('Excluded'), false);
  assert.equal(registerSummary(register, 30, true, now).rows.length, 2);
});

test('stale register flags missed hourly window and preserves saved window', () => {
  const result = registerSummary(register, 7, false, new Date('2026-10-14T15:10:00Z'));
  assert.equal(result.scheduleOverdue, true);
  assert.equal(result.latestExpectedScheduleAt, '2026-10-14T14:45:00.000Z');
  assert.equal(result.window.until, register.checkedAt);
  assert.equal(registerSummary(null).counts, null);
});

test('ads preserve unknown versus zero and withhold incomparable MTD', () => {
  const state = { meta: { currencyCode: 'GBP', mtdComparisonComparable: false }, scorecard: { last7: { leads: null }, previous7: { leads: 0 }, mtd: { leads: 4 }, previousMtd: { leads: 3 } }, ads: [
    { adId: 'a', status: 'ACTIVE', periods: { last7: { leads: 0, spendCents: 0, cplCents: null } } },
    { adId: 'b', status: 'PAUSED', periods: { last7: { leads: null, spendCents: 100, cplCents: null } } },
  ] };
  const result = adsSummary(state);
  assert.equal(result.totals.leads, null);
  assert.equal(result.comparison.totals.leads, 0);
  assert.equal(result.rows[0].leads, null);
  assert.equal(result.rows[1].leads, 0);
  assert.equal(adsSummary(state, '7d', true).rows.length, 1);
  assert.equal(adsSummary(state, 'mtd').comparison.totals, null);
});

test('saved reader refuses redirects and non-read routes', async () => {
  const routes = [];
  const get = await connect({ DASHBOARD_PASSWORD: 'private' }, async (url, init) => {
    routes.push([url, init.method || 'GET', init.redirect]);
    return url.endsWith('/api/auth') ? new Response('{}', { headers: { 'set-cookie': 'session=value; Secure' } }) : new Response('{"data":{"checkedAt":"saved"}}');
  });
  assert.deepEqual(await get('/api/lead-register'), { checkedAt: 'saved' });
  await assert.rejects(get('/api/refresh'), /Unsupported/);
  assert.deepEqual(routes.map(r => r[1]), ['POST', 'GET']);
  assert.ok(routes.every(r => r[2] === 'manual'));
  await assert.rejects(connect({ DASHBOARD_PASSWORD: 'private' }, async () => new Response('', { status: 307 })), /HTTP 307/);
});

test('quota reads snapshot first then stops after one daily-exhausted probe', async () => {
  const paths = [];
  const result = await run({ command: 'quota', days: 30 }, { DASHBOARD_PASSWORD: 'private', HIGHLEVEL_TOKEN: 'private', HIGHLEVEL_LOCATION_ID: 'loc' }, async (url) => {
    paths.push(new URL(url).pathname);
    if (url.endsWith('/api/auth')) return new Response('{}', { headers: { 'set-cookie': 'session=value' } });
    if (url.endsWith('/api/lead-register')) return Response.json({ data: register });
    return new Response('sensitive provider body', { status: 429, headers: { 'x-ratelimit-daily-remaining': '0', 'x-ratelimit-remaining': '100' } });
  }, now);
  assert.deepEqual(paths, ['/api/auth', '/api/lead-register', '/contacts/']);
  assert.equal(result.quota.status, 'daily_quota_exhausted');
  assert.equal(JSON.stringify(result).includes('sensitive'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('CSV quotes multiline fields and neutralises spreadsheet formulas; flags validate', () => {
  const value = csv([{ name: '=SUM(A1)', note: 'a,"b"\nc', spendCents: -3, leads: null }]);
  assert.ok(value.includes("'" + '=SUM(A1)'));
  assert.ok(value.includes('a,""b""\nc'));
  assert.ok(value.includes('"-3"'));
  assert.throws(() => parseOptions(['status', '--format', 'csv']), /CSV requires/);
  assert.throws(() => parseOptions(['enquiries', '--days', '0']), /Days/);
});

test('installed reader runs through a skill-directory symlink', { skip: process.platform === 'win32' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'uktl-skill-link-'));
  try {
    const folder = path.dirname(fileURLToPath(import.meta.url));
    fs.symlinkSync(folder, path.join(temp, 'scripts'));
    const output = execFileSync(process.execPath, [path.join(temp, 'scripts/dashboard.mjs'), 'links'], { encoding: 'utf8' });
    assert.equal(JSON.parse(output).worker, 'uktl-meta-dashboard');
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
