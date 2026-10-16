import fs from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const repo = "/Users/jack/Documents/GitHub/meta-ads-dashboard";
const configPath = "/Users/jack/.config/uktl-meta-dashboard/production.json";
const stat = fs.statSync(configPath);
if (stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error("Production config must be owned by this user and have no group/world access");
const require = createRequire(`${repo}/package.json`);
const { createClient } = require("@libsql/client");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
if (!config.TURSO_DATABASE_URL || !config.TURSO_AUTH_TOKEN || !config.HIGHLEVEL_LOCATION_ID || !config.HIGHLEVEL_TOKEN || !config.HIGHLEVEL_SALES_CALENDAR_ID) throw new Error("Production read settings unavailable");
const wrangler = JSON.parse(fs.readFileSync(`${repo}/wrangler.jsonc`, "utf8"));
const formId = wrangler.vars.HIGHLEVEL_LEAD_FORM_ID;
if (!formId) throw new Error("Configured form ID unavailable");
const database = createClient({ url: config.TURSO_DATABASE_URL, authToken: config.TURSO_AUTH_TOKEN });
const snapshotRow = await database.execute({ sql: "SELECT payload FROM LeadRegisterSnapshot WHERE locationId = ?", args: [config.HIGHLEVEL_LOCATION_ID] });
if (!snapshotRow.rows.length) throw new Error("Saved enquiry register unavailable");
const snapshot = JSON.parse(String(snapshotRow.rows[0].payload));
database.close();

const checked = Date.parse(snapshot.checkedAt);
if (!Number.isFinite(checked) || !Array.isArray(snapshot.entries)) throw new Error("Saved enquiry register malformed");
const cutoff = checked - 30 * 86400000;
const seenContacts = new Set(snapshot.entries.map((entry) => entry.contactId));
const seenSubmissions = new Set(snapshot.entries.flatMap((entry) => entry.submissions.map((submission) => submission.id)));
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function get(path, init = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const curlConfig = [
      `url = ${JSON.stringify(`https://services.leadconnectorhq.com${path}`)}`,
      `header = ${JSON.stringify(`Authorization: Bearer ${config.HIGHLEVEL_TOKEN}`)}`,
      `header = ${JSON.stringify(`Version: ${config.HIGHLEVEL_API_VERSION || "v3"}`)}`,
      'header = "Content-Type: application/json"',
      ...(init.method ? [`request = ${JSON.stringify(init.method)}`] : []),
      ...(init.body ? [`data = ${JSON.stringify(init.body)}`] : []),
    ].join("\n");
    const result = spawnSync("curl", [
      "--silent", "--show-error", "--max-time", "20", "--config", "-",
      "--write-out", "\n__AUDIT_STATUS__:%{http_code}\n__AUDIT_DAILY__:%header{x-ratelimit-daily-remaining}\n",
    ], { input: curlConfig, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) {
      if (attempt === 4) throw new Error(`${path.split("?")[0]} network request failed (curl ${result.status}: ${result.stderr.trim().slice(0, 120)})`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const marker = result.stdout.match(/\n__AUDIT_STATUS__:(\d{3})\n__AUDIT_DAILY__:(\d*)\n$/);
    if (!marker) throw new Error(`${path.split("?")[0]} response status unavailable`);
    const status = Number(marker[1]);
    if (marker[2] === "0") throw new Error(`${path.split("?")[0]} HighLevel daily API quota exhausted`);
    if (status >= 200 && status < 300) return JSON.parse(result.stdout.slice(0, marker.index));
    if (status === 429 && marker[2] === "0") {
      throw new Error(`${path.split("?")[0]} HTTP 429: HighLevel daily API quota exhausted`);
    }
    if ((status === 429 || status >= 500) && attempt < 2) {
      await sleep(status === 429 ? 10000 : 500);
      continue;
    }
    throw new Error(`${path.split("?")[0]} HTTP ${status}`);
  }
}

const startAt = new Date(cutoff).toISOString().slice(0, 10);
// The provider's end date is exclusive; currentSubmissions enforces checkedAt.
const endAt = new Date(checked + 86400000).toISOString().slice(0, 10);
const forms = await get(`/forms/?locationId=${config.HIGHLEVEL_LOCATION_ID}&limit=50`);
const names = Object.fromEntries(forms.forms.map((form) => [form.id, form.name]));
const submissions = [];
let reportedTotal = null;
let submissionsComplete = false;
for (let page = 1; page <= 100; page++) {
  const query = new URLSearchParams({ locationId: config.HIGHLEVEL_LOCATION_ID, startAt, endAt, limit: "100", page: String(page) });
  const data = await get(`/forms/submissions?${query}`);
  if (!Array.isArray(data.submissions)) throw new Error("Malformed form submissions");
  submissions.push(...data.submissions);
  reportedTotal = data.meta?.total;
  if (!data.meta?.nextPage) { submissionsComplete = true; break; }
}
if (!submissionsComplete || submissions.length !== reportedTotal) throw new Error(`Partial forms: ${submissions.length}/${reportedTotal}`);
const currentSubmissions = submissions.filter((submission) => Date.parse(submission.createdAt) >= cutoff && Date.parse(submission.createdAt) <= checked);
const byForm = {};
for (const submission of currentSubmissions) {
  const key = names[submission.formId] || "Unknown form";
  const item = byForm[key] ||= { count: 0, latest: "" };
  item.count++;
  if (submission.createdAt > item.latest) item.latest = submission.createdAt;
}

const contacts = [];
let contactTotal = null;
for (let page = 1; page <= 100; page++) {
  const data = await get("/contacts/search", { method: "POST", body: JSON.stringify({ locationId: config.HIGHLEVEL_LOCATION_ID, page, pageLimit: 100 }) });
  if (!Array.isArray(data.contacts)) throw new Error("Malformed contact collection");
  contacts.push(...data.contacts);
  contactTotal = Number(data.total);
  if (contacts.length >= contactTotal) break;
  if (!data.contacts.length) throw new Error("Contact pagination stalled");
}
if (contacts.length !== contactTotal || new Set(contacts.map((contact) => contact.id)).size !== contacts.length) throw new Error(`Partial/duplicate contacts: ${contacts.length}/${contactTotal}`);
const recentContacts = contacts.filter((contact) => Date.parse(contact.dateAdded) >= cutoff && Date.parse(contact.dateAdded) <= checked);
const missingContacts = recentContacts.filter((contact) => !seenContacts.has(contact.id));
const configuredSubmissions = currentSubmissions.filter((submission) => submission.formId === formId);
const missingSubmissions = configuredSubmissions.filter((submission) => !seenSubmissions.has(submission.id));
const leadCandidates = snapshot.entries.filter((entry) => !entry.test && (
  entry.submissions.some((submission) => Date.parse(submission.at) >= cutoff)
  || (Date.parse(entry.contactCreated) >= cutoff && entry.tags.some((tag) => tag.trim().toLowerCase() === "new lead"))
));
const calendars = await get(`/calendars/?locationId=${config.HIGHLEVEL_LOCATION_ID}`);
const allCalendarEvents = [];
for (const calendar of calendars.calendars) {
  const query = new URLSearchParams({
    locationId: config.HIGHLEVEL_LOCATION_ID,
    calendarId: calendar.id,
    startTime: String(checked - 90 * 86400000),
    endTime: String(checked + 90 * 86400000),
  });
  const data = await get(`/calendars/events?${query}`);
  if (!Array.isArray(data.events)) throw new Error("Malformed calendar events");
  allCalendarEvents.push(...data.events.map((event) => ({ ...event, calendarName: calendar.name })));
}
const otherCalendarBookings = leadCandidates.filter((entry) => !entry.appointments.length && allCalendarEvents.some((event) => event.contactId === entry.contactId && event.calendarId !== config.HIGHLEVEL_SALES_CALENDAR_ID && !event.deleted));
const configuredEventIds = new Set(snapshot.entries.flatMap((entry) => entry.appointments.map((appointment) => appointment.id)));
const configuredEventsMissing = allCalendarEvents.filter((event) => event.calendarId === config.HIGHLEVEL_SALES_CALENDAR_ID && !event.deleted && Date.parse(event.startTime) >= checked - 90 * 86400000 && Date.parse(event.startTime) <= checked + 90 * 86400000 && seenContacts.has(event.contactId) && !configuredEventIds.has(event.id));
const ageMinutes = Math.round((Date.now() - checked) / 60000);
const result = {
  checkedAt: snapshot.checkedAt,
  ageMinutes,
  savedEntries: snapshot.entries.length,
  providerContacts: contacts.length,
  recentProviderContacts: recentContacts.length,
  recentContactsMissingFromRegister: missingContacts.length,
  recentProviderForms: byForm,
  configuredFormSubmissions: configuredSubmissions.length,
  configuredSubmissionsMissingFromRegister: missingSubmissions.length,
  configuredCalendarEventsMissingFromRegister: configuredEventsMissing.length,
  configuredCalendarMissingDetails: configuredEventsMissing.map((event) => ({
    startsAt: event.startTime,
    status: event.appointmentStatus,
    contactCreated: snapshot.entries.find((entry) => entry.contactId === event.contactId)?.contactCreated,
    contactLastChecked: snapshot.entries.find((entry) => entry.contactId === event.contactId)?.checkedAt,
    hasForm: !!snapshot.entries.find((entry) => entry.contactId === event.contactId)?.submissions.length,
  })),
  leadsMarkedUnbookedWithOtherCalendarEvents: otherCalendarBookings.length,
  calendars: calendars.calendars.map((calendar) => ({ name: calendar.name, configured: calendar.id === config.HIGHLEVEL_SALES_CALENDAR_ID, events: allCalendarEvents.filter((event) => event.calendarId === calendar.id).length })),
  pass: ageMinutes <= 90 && missingContacts.length === 0 && missingSubmissions.length === 0 && configuredEventsMissing.length === 0 && otherCalendarBookings.length === 0,
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
