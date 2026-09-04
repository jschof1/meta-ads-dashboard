import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { formatDateLabel, formatMoney } from "../lib/format.ts";
import { UKTL_CONFIG } from "../lib/uktl-config.ts";
import { classifyAd, classifyCpl } from "../lib/targets.ts";

test("UKTL configuration is typed, single-business, and explicit about optional inputs", () => {
  assert.equal(UKTL_CONFIG.businessName, "UK Trade Leads");
  assert.equal(UKTL_CONFIG.locale, "en-GB");
  assert.equal(UKTL_CONFIG.currencySource, "Meta account");
  assert.deepEqual(UKTL_CONFIG.funnel.map((stage) => stage.label), [
    "Lead",
    "Contacted",
    "Qualified",
    "Call booked",
    "Call attended",
    "Won customer",
    "Lost",
  ]);
  assert.equal(UKTL_CONFIG.targets.dailyBudgetMinorUnits, null);
  assert.equal(UKTL_CONFIG.targets.monthlyBudgetMinorUnits, null);
  assert.equal(UKTL_CONFIG.targets.cpl.targetMinorUnits, null);
  assert.equal(UKTL_CONFIG.targets.targetCacMinorUnits, null);
  assert.equal(UKTL_CONFIG.evidence.unknownWhenMissing, true);
  assert.equal(UKTL_CONFIG.evidence.compareMatchedPeriods, true);
  assert.match(UKTL_CONFIG.brief, /Lead quality beats raw lead volume/);
});

test("money and dates use the Meta account currency and account timezone", () => {
  assert.equal(formatMoney(12345, "GBP"), "£123.45");
  assert.equal(formatMoney(12345, "EUR"), "€123.45");
  assert.equal(formatMoney(12345, "JPY"), "JP¥12,345");
  assert.equal(formatMoney(12345, "KWD"), "KWD\u00a012.345");
  assert.equal(formatMoney(12345, null), "Currency pending");
  assert.equal(formatMoney(null, "GBP"), "—");
  assert.match(formatDateLabel("2026-09-04", "Europe/London"), /^04\s/);
  assert.match(formatDateLabel("2026-09-04", "Pacific/Kiritimati"), /^04\s/);
  assert.match(formatDateLabel("2026-09-04", "Etc/GMT+12"), /^04\s/);
  assert.equal(formatDateLabel("2026-02-30", "Europe/London"), "2026-02-30");
});

test("missing CPL targets remain unknown instead of creating a verdict", () => {
  assert.equal(classifyCpl(2500), "unknown");
  assert.deepEqual(classifyAd({ spendCents: 5000, leads: 3, cplCents: 1667, ctrLink: 0.02 }), {
    verdict: "unknown",
    reason: "No CPL target is configured; compare this ad with its historical baseline.",
  });
});

test("the misleading budget simulator is removed from the dashboard surface", async () => {
  await assert.rejects(() => access(new URL("../components/budget-simulator.tsx", import.meta.url)));
  const page = await readFile(new URL("../app/(dashboard)/page.tsx", import.meta.url), "utf8");
  assert.equal(page.includes("BudgetSimulator"), false);
});

test("user-facing source files contain the UKTL domain terms only", async () => {
  const paths = [
    "../app/layout.tsx",
    "../app/(public)/login/page.tsx",
    "../app/(dashboard)/page.tsx",
    "../components/top-bar.tsx",
    "../components/scorecard.tsx",
    "../components/metric-hero-cards.tsx",
    "../components/funnel.tsx",
    "../components/creative-leaderboard.tsx",
    "../components/anomaly-banner.tsx",
    "../components/plan-visual.tsx",
    "../app/api/insights/summary/route.ts",
    "../app/api/insights/brief/route.ts",
    "../README.md",
    "../INSTALL.md",
    "../public/plan.md.template",
    "../.env.example",
  ];
  const source = (await Promise.all(paths.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  for (const forbidden of ["Business Owners US", "Framework Leads", "webinar", "enrollment", "registrations", "CPR", "$4,500", "$50/day", "USD", "Budget What-If Simulator"]) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `found forbidden term: ${forbidden}`);
  }
});
