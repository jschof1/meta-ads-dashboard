import { prisma, withDatabaseClient } from "./db";
import { accountLocalDate } from "./periods";
import { buildMonthlyReport, MONTHLY_HISTORY_START, type MonthlyInsight } from "./monthly-performance";
import type { LeadRegister } from "./lead-register";
import { recoverStoredResult } from "./stored-result-events";

/** One database snapshot, no Meta or HighLevel calls, and no contact details in the response. */
export async function readMonthlyPerformance(now = new Date(), db = prisma) {
  const account = process.env.META_AD_ACCOUNT_ID?.trim();
  if (!account) throw new Error("Meta account unavailable");
  const accountId = account.startsWith("act_") ? account : `act_${account}`;
  const campaignId = process.env.META_CAMPAIGN_ID?.trim() || null;
  const attribution = (process.env.META_ATTRIBUTION_WINDOWS?.split(",").map(v => v.trim()).filter(Boolean) || ["7d_click", "1d_view"]).join(",") || "7d_click,1d_view";
  return withDatabaseClient(db, async client => {
    const tx = await client.transaction("read");
    try {
      const args = [accountId, attribution, campaignId];
      const success = await tx.execute({ sql: 'SELECT * FROM SyncRun WHERE accountId=? AND attributionKey=? AND campaignId IS ? AND status=\'SUCCEEDED\' ORDER BY finishedAt DESC LIMIT 1', args });
      const run = success.rows[0];
      const timezone = String(run?.timezoneName || "UTC"), currency = String(run?.currencyCode || "GBP");
      const today = accountLocalDate(now, timezone);
      const since = MONTHLY_HISTORY_START;
      const saved = run ? await tx.execute({
        sql: 'SELECT d.* FROM DailyInsight d JOIN SyncRun s ON s.id=d.syncRunId WHERE s.accountId=? AND s.attributionKey=? AND s.campaignId IS ? AND s.status=\'SUCCEEDED\' AND d.attributionKey=? AND d.scopeKey=? AND d.date>=? AND d.date<=? ORDER BY d.date,d.entityId',
        args: [...args, attribution, campaignId || "account", since, today],
      }) : { rows: [] };
      const rows: MonthlyInsight[] = saved.rows.map(row => {
        const date = String(row.date);
        const omitted = date >= String(run.requestedSince) && date <= String(run.requestedUntil) && row.syncRunId !== run.id;
        const value = (key: string) => omitted || row[key] == null ? null : Number(row[key]);
        const recovered = !omitted && row.leads == null ? recoverStoredResult(String(row.rawActions), row.resultActionType == null ? null : String(row.resultActionType), process.env.META_PRIMARY_RESULT_ACTION_TYPE) : null;
        return { date, level: String(row.level), entityId: String(row.entityId), currencyCode: row.currencyCode == null ? null : String(row.currencyCode), spendMinorUnits: value("spendMinorUnits"), impressions: value("impressions"), linkClicks: value("linkClicks"), leads: value("leads") ?? recovered };
      });
      const metadata = await tx.execute('SELECT metaId,name FROM Campaign UNION ALL SELECT metaId,name FROM Ad');
      const names = Object.fromEntries(metadata.rows.map(row => [String(row.metaId), String(row.name)]));
      let register: LeadRegister | null = null;
      const locationId = process.env.HIGHLEVEL_LOCATION_ID;
      if (locationId) {
        const savedRegister = await tx.execute({ sql: 'SELECT payload FROM LeadRegisterSnapshot WHERE locationId=?', args: [locationId] });
        register = savedRegister.rows[0] ? JSON.parse(String(savedRegister.rows[0].payload)) as LeadRegister : null;
      }
      await tx.commit();
      return buildMonthlyReport({ rows, accountId, timezone, currency, attribution, scope: campaignId ? `Campaign ${campaignId}` : "Whole ad account", metaCheckedAt: run?.finishedAt ? new Date(String(run.finishedAt)).toISOString() : null, register, names, now });
    } catch (error) { await tx.rollback(); throw error; }
    finally { tx.close(); }
  });
}
