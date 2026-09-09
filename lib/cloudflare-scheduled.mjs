/** Cloudflare supplies CF-Connecting-IP; client-supplied forwarding headers must not bypass login throttling. */
export function normalizeClientAddress(request) {
  const headers = new Headers(request.headers);
  headers.set("x-forwarded-for", headers.get("cf-connecting-ip") || "unknown");
  headers.delete("x-real-ip");
  return new Request(request, { headers });
}

/** Invoke the existing authenticated route so manual and scheduled syncs share one implementation. */
export async function runScheduledSync(event, env, fetchHandler) {
  const paths = { "15 * * * *": "/api/cron/sync-leads", "0 6 * * *": "/api/cron/sync-meta", "30 6 * * *": "/api/cron/sync-highlevel" };
  const path = paths[event.cron];
  if (!path) throw new Error("Unknown dashboard schedule");
  if (path.endsWith("sync-highlevel") && env.HIGHLEVEL_SYNC_ENABLED !== "true") {
    console.info("HighLevel schedule skipped: integration disabled");
    return;
  }
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) throw new Error("Cron authentication is not configured");
  const response = await fetchHandler(new Request(`https://dashboard.internal${path}`, {
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
  }));
  // Do not log provider payloads, headers or credentials.
  console.info("Dashboard scheduled sync", { path, status: response.status });
  if (!response.ok) throw new Error(`Scheduled sync failed with HTTP ${response.status}`);
}
