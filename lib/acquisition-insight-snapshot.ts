import type { DailyInsight, SyncRun } from "@prisma/client";
import { recoverStoredResult } from "./stored-result-events";

/** Read only completed runs in the caller's exact account/reporting scope.
 * Refreshes retain old rows for audit; an omitted old row must never keep its
 * previous metrics after a newer successful refresh covered the same date.
 */
export function acquisitionInsightSnapshot(insights: DailyInsight[], runs: SyncRun[], configuredType?: string) {
  const successes = runs.filter(r => r.status === "SUCCEEDED" && r.finishedAt)
    .sort((a, b) => +b.finishedAt! - +a.finishedAt! || +b.startedAt - +a.startedAt);
  const byId = new Map(successes.map(r => [r.id, r]));
  const latestByDay = new Map<string, SyncRun | undefined>();
  let omittedRows = 0;
  const rows = insights.filter(row => {
    const run = byId.get(row.syncRunId);
    return run && row.attributionKey === run.attributionKey && row.scopeKey === (run.campaignId || "account");
  }).map(row => {
    if (!latestByDay.has(row.date)) latestByDay.set(row.date, successes.find(r => r.requestedSince && r.requestedUntil && row.date >= r.requestedSince && row.date <= r.requestedUntil));
    const latest = latestByDay.get(row.date);
    if (latest && row.syncRunId !== latest.id) {
      omittedRows++;
      return { ...row, spendMinorUnits: null, impressions: null, reach: null, clicks: null, linkClicks: null, leads: null,
        cplMinorUnits: null, cpcMinorUnits: null, cpmMinorUnits: null, ctrLink: null, frequency: null };
    }
    return { ...row, leads: configuredType && row.resultActionType === configuredType
      ? row.leads ?? recoverStoredResult(row.rawActions, row.resultActionType, configuredType) : null };
  });
  return { rows, omittedRows };
}
