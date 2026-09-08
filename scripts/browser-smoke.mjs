import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import {
  createSmokeCertificate, readSmokeCertificate, runCommand, safeSmokeEnvironment,
  startHttpsProxy, startLibsqlSmokeServer, startProcess, stopLibsqlSmokeServer, stopProcess, unusedLoopbackPort,
} from "./libsql-smoke-server.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const password = "browser-smoke-password";
const authSecret = "browser-smoke-auth-secret-that-is-at-least-32-characters";
const cronSecret = "browser-smoke-cron-secret-that-is-at-least-32-characters";
const sessionCookieName = "uktl_dashboard_session";
const smokeNow = new Date();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer(server, baseUrl) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null || server.child.signalCode !== null) throw new Error(`Next production server exited before readiness; see ${server.logPath}`);
    try {
      const response = await fetch(baseUrl + "/login", { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
      lastError = new Error(`Next /login returned ${response.status}`);
    } catch (error) { lastError = error; }
    await wait(250);
  }
  throw new Error(`Next production server did not become ready: ${lastError?.message}; see ${server.logPath}`, { cause: lastError });
}

async function saveJson(directory, name, value) {
  await writeFile(join(directory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
}

function smokeEvidence(today) {
  const metrics = {
    spendCents: 10_000,
    impressions: 1_000,
    reach: 800,
    clicks: 100,
    linkClicks: 50,
    leads: 2,
    frequency: 1.25,
    cplCents: 5_000,
    cpmCents: 1_000,
    cpcCents: 100,
    ctrLink: 5,
  };
  return {
    evidenceVersion: 1,
    ruleVersion: "pr06.v1",
    comparisonDays: 7,
    ranges: { current: { since: today, until: today }, previous: null, cumulative: null },
    sampleSize: 3,
    seriesPoints: 0,
    daysActive: 14,
    confidenceScore: 75,
    confidenceFactors: {
      currentSpendImpressionsComplete: true,
      currentLeadsKnown: true,
      currentEvidenceSufficient: true,
      previousEvidenceSufficient: false,
      sampleSizeSufficient: true,
      seriesSufficient: false,
      daysActiveSufficient: true,
    },
    status: "ACTIVE",
    learningState: null,
    current: metrics,
    previous: null,
    cumulative: null,
    series: [],
    deltas: { spendPct: null, leadsPct: null, cplPct: null, ctrPct: null, frequencyPct: null },
    thresholds: {
      minLeads: 3,
      minImpressions: 1_000,
      minSpendCents: 1_000,
      cplTargetCents: 1_500,
      cplAcceptableCents: 2_500,
      cplMaximumCents: 3_500,
      frequencyWatch: 2,
      frequencyAlert: 3,
      expectedSpendCents: null,
      budgetCents: null,
    },
    notes: ["Seeded browser smoke evidence"],
  };
}

async function seedSmokeDatabase(connection) {
  const accountId = "act_browser_smoke";
  const attributionKey = "7d_click,1d_view";
  const runId = "browser-smoke-sync";
  const targetId = "ad-browser-smoke";
  const fingerprint = `${accountId}|account|${attributionKey}|browser-smoke-pause`;
  const now = smokeNow;
  const today = now.toISOString().slice(0, 10);
  const db = new PrismaClient({ adapter: new PrismaLibSQL(connection) });
  try {
    await db.syncRun.create({
      data: {
        id: runId,
        accountId,
        accountName: "Browser smoke account",
        currencyCode: "GBP",
        timezoneName: "UTC",
        trigger: "browser-smoke",
        status: "SUCCEEDED",
        attributionKey,
        requestedSince: today,
        requestedUntil: today,
        startedAt: new Date(now.getTime() - 60_000),
        finishedAt: now,
        rowsFetched: 1,
        rowsWritten: 1,
      },
    });
    await db.dailyInsight.create({
      data: {
        id: "browser-smoke-insight",
        date: today,
        level: "account",
        entityId: accountId,
        attributionKey,
        scopeKey: "account",
        currencyCode: "GBP",
        spendMinorUnits: 10_000,
        impressions: 1_000,
        reach: 800,
        clicks: 100,
        linkClicks: 50,
        leads: 2,
        cplMinorUnits: 5_000,
        cpcMinorUnits: 100,
        cpmMinorUnits: 1_000,
        ctrLink: 5,
        frequency: 1.25,
        resultActionType: "lead",
        rawActions: "[]",
        raw: "{}",
        observedAt: now,
        syncRunId: runId,
      },
    });
    await db.ad.create({
      data: {
        id: "browser-smoke-ad-row",
        metaId: targetId,
        name: "Browser smoke ad",
        configuredStatus: "ACTIVE",
        effectiveStatus: "ACTIVE",
        lastSeenSyncRunId: runId,
        raw: "{}",
        createdAt: now,
        updatedAt: now,
      },
    });
    await db.recommendation.create({
      data: {
        id: "browser-smoke-recommendation",
        fingerprint,
        accountId,
        campaignId: null,
        attributionKey,
        type: "pause_candidate",
        analysisWindowDays: 7,
        ruleVersion: "pr06.v1",
        targetType: "ad",
        targetId,
        targetName: "Browser smoke ad",
        severity: "alert",
        confidence: "high",
        lifecycle: "OPEN",
        reason: "Browser smoke fixture: review the stored evidence before changing this ad.",
        evidence: JSON.stringify(smokeEvidence(today)),
        proposedAction: "Pause this ad after operator review.",
        sourceSyncRunId: runId,
        firstSeenAt: now,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    const stored = await db.dailyInsight.findUnique({ where: { id: "browser-smoke-insight" } });
    assert(stored?.spendMinorUnits === 10_000 && stored.currencyCode === "GBP", "expected remote fixture readback of GBP 100.00");
  } finally {
    await db.$disconnect();
  }
}

async function isolatedProductionApp(directory) {
  const appDirectory = join(directory, "app");
  await mkdir(appDirectory);
  // next start loads .env files from its project directory. Expose only the
  // existing production build and runtime inputs, never repository .env files.
  // The config is linked unchanged; the production application has no bypass.
  for (const name of [".next", "node_modules", "public", "package.json", "next.config.ts", "next.config.mjs", "next.config.js"]) {
    const source = join(root, name);
    try { await stat(source); } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    await symlink(source, join(appDirectory, name));
  }
  return appDirectory;
}

async function runFixture(directory, evidenceDirectory) {
  const evidence = { status: "running", nodeEnv: process.env.NODE_ENV, checks: [], startedAt: new Date().toISOString() };
  let sqld;
  let server;
  let nextProxy;
  let browser;
  let context;
  let page;
  const browserIssues = [];
  const unexpectedRequests = [];
  try {
    assert(process.env.NODE_ENV === "production", "browser fixture must run with NODE_ENV=production");
    const tls = await readSmokeCertificate(directory);
    assert(process.env.NODE_EXTRA_CA_CERTS === tls.certPath, "the fixture client must trust its temporary CA at Node startup");
    const buildId = (await readFile(join(root, ".next", "BUILD_ID"), "utf8")).trim();
    assert(buildId, "No production build found; run npm run build before test:browser");
    evidence.build = { id: buildId, modifiedAt: (await stat(join(root, ".next", "BUILD_ID"))).mtime.toISOString() };
    console.log(`Browser smoke: next start, NODE_ENV=production, build ${buildId}`);

    sqld = await startLibsqlSmokeServer({ directory, evidenceDirectory, tls });
    const connection = { url: sqld.url, authToken: sqld.authToken };
    evidence.database = { url: sqld.url, adapter: "@prisma/adapter-libsql (remote HTTPS)", release: sqld.release };
    await runCommand(process.execPath, ["--input-type=module", "-e", `
      try {
        await fetch(process.argv[1], { signal: AbortSignal.timeout(5000) });
        throw new Error("Untrusted fixture certificate was unexpectedly accepted");
      } catch (error) {
        if (!["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(error.cause?.code)) throw error;
        console.log("Untrusted client correctly rejected the fixture certificate: " + error.cause.code);
      }
    `, sqld.url + "/health"], {
      cwd: directory, env: safeSmokeEnvironment(), logPath: join(evidenceDirectory, "tls-untrusted.log"),
    });
    const client = createClient(connection);
    try {
      assert(client.protocol === "http" && new URL(connection.url).protocol === "https:", "expected real remote libSQL over HTTPS");
      const result = await client.execute("SELECT sqlite_version() AS version");
      evidence.database.sqliteVersion = result.rows[0].version;
      const empty = await client.execute("SELECT count(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'");
      assert(Number(empty.rows[0].count) === 0, "expected a new isolated database before migration");
    } finally { client.close(); }
    const unauthenticatedClient = createClient({ url: sqld.url });
    let rejected = false;
    try { await unauthenticatedClient.execute("SELECT 1"); } catch { rejected = true; }
    finally { unauthenticatedClient.close(); }
    assert(rejected && sqld.requests.some((entry) => entry.status === 401), "expected sqld to reject a remote client without the temporary JWT");
    evidence.checks.push("untrusted TLS rejected; trusted remote HTTPS adapter connected; sqld rejected missing JWT");

    const appEnv = {
      ...safeSmokeEnvironment(),
      NODE_ENV: "production",
      NODE_EXTRA_CA_CERTS: tls.certPath,
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: "",
      TURSO_DATABASE_URL: sqld.url,
      TURSO_AUTH_TOKEN: sqld.authToken,
      DASHBOARD_PASSWORD: password,
      AUTH_SECRET: authSecret,
      CRON_SECRET: cronSecret,
      META_MARKETING_TOKEN: "",
      META_AD_ACCOUNT_ID: "act_browser_smoke",
      META_ATTRIBUTION_WINDOWS: "7d_click,1d_view",
      META_WRITES_ENABLED: "false",
      ANTHROPIC_API_KEY: "",
      HIGHLEVEL_TOKEN: "",
      HIGHLEVEL_PRIVATE_INTEGRATION_TOKEN: "",
      HIGHLEVEL_SYNC_ENABLED: "false",
    };
    const appDirectory = await isolatedProductionApp(directory);
    await runCommand(process.execPath, [join(root, "scripts", "apply-turso-migrations.mjs")], {
      cwd: appDirectory, env: { ...appEnv, TURSO_MIGRATION_CONFIRM: "yes" }, logPath: join(evidenceDirectory, "migrations.log"),
    });
    await seedSmokeDatabase(connection);
    evidence.checks.push("production Turso migrations and GBP 100.00 seed/readback via remote adapters");
    console.log("Browser smoke: official sqld verified, HTTPS/JWT checked, remote migrations and fixture ready");

    const upstreamPort = await unusedLoopbackPort();
    const requestedPort = process.env.BROWSER_SMOKE_PORT === undefined ? 0 : Number(process.env.BROWSER_SMOKE_PORT);
    assert(Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535, "BROWSER_SMOKE_PORT must be an integer from 0 to 65535");
    nextProxy = await startHttpsProxy({ tls, upstreamPort, port: requestedPort });
    const baseUrl = nextProxy.url;
    evidence.application = { url: baseUrl, command: "next start", dotenvIsolated: true, metaWritesEnabled: false };
    server = startProcess(process.execPath, [nextBin, "start", appDirectory, "--hostname", "127.0.0.1", "--port", String(upstreamPort)], {
      cwd: appDirectory, env: appEnv, logPath: join(evidenceDirectory, "next.log"),
    });
    await waitForServer(server, baseUrl);

    browser = await chromium.launch({
      headless: true,
      env: safeSmokeEnvironment(),
      // Trust only this disposable certificate's public key in Chromium.
      // Node/app/database TLS validation remains enabled via NODE_EXTRA_CA_CERTS.
      args: [`--ignore-certificate-errors-spki-list=${tls.spki}`],
    });
    context = await browser.newContext({ baseURL: baseUrl });
    context.setDefaultTimeout(20_000);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === baseUrl) return route.continue();
      unexpectedRequests.push(route.request().url());
      return route.abort();
    });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") browserIssues.push(message.type() + ": " + message.text());
    });
    page.on("pageerror", (error) => browserIssues.push("pageerror: " + error.message));

    const unauthorized = await context.request.get("/api/dashboard/state");
    assert(unauthorized.status() === 401, "expected unauthenticated dashboard rejection, got " + unauthorized.status());
    evidence.checks.push("unauthenticated dashboard API returns 401");

    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "UK Trade Leads" }).waitFor();
    await page.locator("#password").fill(password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth" && response.request().method() === "POST"),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);
    assert(loginResponse.status() === 200, "expected successful production login, got " + loginResponse.status());
    await page.waitForURL((url) => new URL(url).pathname === "/");
    const cookie = (await context.cookies(baseUrl)).find((entry) => entry.name === sessionCookieName);
    assert(cookie?.secure && cookie.httpOnly, "expected a Secure, HttpOnly production session cookie");
    assert(cookie.sameSite === "Strict" && cookie.path === "/", "expected Strict same-site session cookie scoped to /");
    assert(!(await page.evaluate(() => document.cookie)).includes(sessionCookieName), "session cookie must be hidden from browser JavaScript");
    const setCookie = (await loginResponse.allHeaders())["set-cookie"] ?? "";
    assert(/;\s*Secure(?:;|$)/i.test(setCookie) && /;\s*HttpOnly(?:;|$)/i.test(setCookie), "expected Secure and HttpOnly on the login response itself");
    evidence.sessionCookie = { name: cookie.name, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, path: cookie.path };
    evidence.checks.push("browser login; Secure/HttpOnly/Strict cookie present and hidden from document.cookie");

    const diagnostics = page.locator('section[aria-label="System diagnostics"]');
    await diagnostics.getByRole("heading", { name: "System diagnostics" }).waitFor();
    await diagnostics.getByText("Database").waitFor();
    await diagnostics.getByText("Meta actions").waitFor();
    await diagnostics.getByText("disabled", { exact: true }).waitFor();
    await page.getByText("£100.00", { exact: true }).first().waitFor();
    const readAt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(smokeNow);
    await page.getByText(`Read at ${readAt}`, { exact: true }).waitFor();
    await page.getByText("Costs are in the Meta account currency.").waitFor();
    evidence.checks.push("stored GBP 100.00, exact read timestamp, currency explanation and diagnostics visible");

    const prepare = page.getByRole("button", { name: "Prepare approval", exact: true });
    await prepare.waitFor();
    await prepare.click();
    const approve = page.getByRole("button", { name: "Approve", exact: true });
    await approve.waitFor();
    await approve.click();
    const execute = page.getByRole("button", { name: "Execute approved change", exact: true });
    await execute.waitFor();
    assert(await execute.isDisabled(), "expected approved Meta execution to remain disabled");
    evidence.checks.push("prepare and approve stored recommendation; execution remains disabled");

    const diagnosticResponse = await context.request.get("/api/diagnostics");
    assert(diagnosticResponse.status() === 200, "expected authenticated diagnostics, got " + diagnosticResponse.status());
    const diagnosticPayload = await diagnosticResponse.json();
    assert(diagnosticPayload.database?.status === "ok", "expected a reachable smoke-test database");
    assert(diagnosticPayload.database?.configuration === "configured", "expected production Turso configuration to pass the application guard");
    assert(diagnosticPayload.migrations?.status === "ok", "expected applied remote migrations to match the production build");
    assert(diagnosticPayload.meta?.actionGate?.status === "disabled", "expected Meta writes to remain disabled");
    assert(diagnosticPayload.meta?.configuration === "not_configured", "expected live Meta reads to remain unconfigured");
    assert(diagnosticPayload.meta?.sync?.lastSuccessfulSyncAt, "expected the seeded stored sync to be visible");
    assert(diagnosticPayload.ai?.configuration === "not_configured", "expected AI provider credentials to remain absent");
    assert(diagnosticPayload.highLevel?.providerReady === false, "expected HighLevel provider to remain unconfigured");
    await saveJson(evidenceDirectory, "diagnostics.json", diagnosticPayload);
    evidence.checks.push("diagnostics confirm remote database/migrations, seeded sync and disabled/unconfigured providers");
    await diagnostics.getByText("disabled", { exact: true }).waitFor();
    await page.screenshot({ path: join(evidenceDirectory, "dashboard-approved.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await diagnostics.scrollIntoViewIfNeeded();
    const mobileLayout = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert(mobileLayout.scrollWidth <= mobileLayout.width, "mobile dashboard must not overflow the viewport");
    assert(await execute.isDisabled(), "mobile viewport must not remove the execution safety gate");
    await page.screenshot({ path: join(evidenceDirectory, "dashboard-mobile.png"), fullPage: true });
    evidence.checks.push("390px mobile dashboard has no horizontal overflow and retains the disabled execution gate");
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.getByRole("button", { name: "Log out" }).click();
    await page.waitForURL((url) => new URL(url).pathname === "/login");
    assert(!(await context.cookies(baseUrl)).some((entry) => entry.name === sessionCookieName), "expected logout to remove the session cookie");
    const afterLogout = await context.request.get("/api/dashboard/state");
    assert(afterLogout.status() === 401, "expected protected dashboard rejection after logout");
    assert(browserIssues.length === 0, "browser console reported issues: " + browserIssues.join("; "));
    assert(unexpectedRequests.length === 0, "unexpected browser network requests: " + unexpectedRequests.join(", "));
    evidence.checks.push("logout clears cookie and restores API 401; no browser errors or external requests");

    // Verify the built application's production-only guard, not just a unit
    // predicate. A local datasource must never become durable Vercel storage.
    await stopProcess(server);
    const forbiddenLocalDatabase = join(directory, "must-not-exist.db");
    server = startProcess(process.execPath, [nextBin, "start", appDirectory, "--hostname", "127.0.0.1", "--port", String(upstreamPort)], {
      cwd: appDirectory,
      env: { ...appEnv, DATABASE_URL: `file:${forbiddenLocalDatabase}`, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" },
      logPath: join(evidenceDirectory, "next-misconfigured.log"),
    });
    await waitForServer(server, baseUrl);
    const blockedLogin = await context.request.post("/api/auth", { data: { password } });
    assert(blockedLogin.status() === 503, "production login must fail closed without Turso");
    const storedSessionHeader = { Cookie: `${sessionCookieName}=${cookie.value}` };
    const blockedDashboard = await context.request.get("/api/dashboard/state", { headers: storedSessionHeader });
    assert(blockedDashboard.status() === 503, "authenticated production reads must reject a local-only database");
    const blockedCron = await context.request.get("/api/cron/sync-meta", { headers: { Authorization: `Bearer ${cronSecret}` } });
    assert(blockedCron.status() === 503, "authorised production cron must reject a local-only database");
    const blockedDiagnostics = await context.request.get("/api/diagnostics", { headers: storedSessionHeader });
    assert(blockedDiagnostics.status() === 200, "safe diagnostics should remain readable when storage is unconfigured");
    assert((await blockedDiagnostics.json()).database.configuration === "misconfigured", "diagnostics must identify missing production storage");
    let forbiddenDatabaseExists = true;
    try { await stat(forbiddenLocalDatabase); } catch (error) {
      if (error.code !== "ENOENT") throw error;
      forbiddenDatabaseExists = false;
    }
    assert(!forbiddenDatabaseExists, "production guard must not create a local fallback database");
    evidence.checks.push("built production login/dashboard/cron fail closed without Turso; safe diagnostics remain available; no local database created");
    evidence.status = "passed";
    console.log(`Browser smoke passed: ${evidence.checks.length} production checks`);
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error.stack ?? String(error);
    if (page) await page.screenshot({ path: join(evidenceDirectory, "failure.png"), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    // Preserve evidence on success and failure; the parent removes only the
    // disposable database, binary, certificate and runtime links after exit.
    if (context) await context.tracing.stop({ path: join(evidenceDirectory, "trace.zip") }).catch(() => {});
    if (browser) await browser.close();
    await stopProcess(server);
    if (nextProxy) await nextProxy.close();
    if (sqld) {
      await stopLibsqlSmokeServer(sqld);
    }
    evidence.finishedAt = new Date().toISOString();
    await saveJson(evidenceDirectory, "browser-issues.json", { browserIssues, unexpectedRequests });
    await saveJson(evidenceDirectory, "result.json", evidence);
  }
}

async function main() {
  const evidenceDirectory = await mkdtemp(join(tmpdir(), "uktl-browser-smoke-evidence-"));
  const directory = await mkdtemp(join(tmpdir(), "uktl-browser-smoke-runtime-"));
  console.log(`Browser smoke evidence: ${evidenceDirectory}`);
  let worker;
  let interrupted = false;
  let timedOut = false;
  let timeout;
  const onSignal = () => {
    interrupted = true;
    void stopProcess(worker, { group: true });
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    const { certPath } = await createSmokeCertificate(directory, evidenceDirectory);
    // Node reads NODE_EXTRA_CA_CERTS only at startup. Re-execute this harness
    // under a clean environment so both Prisma/libSQL and Playwright requests
    // validate the temporary certificate without disabling TLS validation.
    if (interrupted) throw new Error("Browser smoke interrupted");
    worker = startProcess(process.execPath, [scriptPath, "--fixture", directory, evidenceDirectory], {
      cwd: root,
      env: {
        ...safeSmokeEnvironment(), NODE_ENV: "production", NODE_EXTRA_CA_CERTS: certPath,
        ...(process.env.BROWSER_SMOKE_PORT === undefined ? {} : { BROWSER_SMOKE_PORT: process.env.BROWSER_SMOKE_PORT }),
      },
      detached: true,
      logPath: join(evidenceDirectory, "harness.log"),
    });
    worker.child.stdout.pipe(process.stdout);
    worker.child.stderr.pipe(process.stderr);
    timeout = setTimeout(() => {
      timedOut = true;
      void stopProcess(worker, { group: true });
    }, 300_000);
    const result = await worker.completed;
    if (interrupted || timedOut || result.code !== 0) throw new Error(`Production browser smoke failed (${timedOut ? "five-minute timeout" : result.error?.message ?? result.signal ?? result.code}); evidence: ${evidenceDirectory}`);
  } catch (error) {
    await saveJson(evidenceDirectory, "harness-error.json", { error: error.stack ?? String(error) });
    throw error;
  } finally {
    clearTimeout(timeout);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await stopProcess(worker, { group: true });
    await rm(directory, { recursive: true, force: true });
    console.log(`Evidence retained: ${evidenceDirectory} (temporary runtime removed)`);
  }
}

// --fixture is an internal child process, launched above with its CA at startup.
const run = process.argv[2] === "--fixture"
  ? runFixture(process.argv[3], process.argv[4])
  : main();
await run.catch((error) => { console.error(error); process.exitCode = 1; });
