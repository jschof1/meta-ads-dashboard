import { object } from "./acquisition-attribution";
import { UKTL_STRIPE_ACCOUNT, type StripeReadSnapshot } from "./customer-journey";

type Row = Record<string, unknown>;
export async function readStripeSnapshot(options: { token?: string; fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<StripeReadSnapshot> {
  const token = options.token ?? process.env.STRIPE_READ_KEY;
  if (!token || !/^(rk|sk)_live_/.test(token)) throw new Error("Live read-only Stripe connection unavailable");
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  async function read(path: string): Promise<Row> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetcher(`https://api.stripe.com/v1/${path}`, {
          method: "GET", headers: { Authorization: `Bearer ${token}`, "Stripe-Version": "2026-09-30.endive" },
          redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
        });
      } catch { if (attempt < 2) { await sleep(500 * 2 ** attempt); continue; } throw new Error("Stripe read failed"); }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const raw = response.headers.get("retry-after");
          const delay = raw ? (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 500 * 2 ** attempt;
          if (Number.isFinite(delay) && delay >= 0 && delay <= 10_000) { await sleep(delay + 100); continue; }
        }
        throw new Error(`Stripe read returned HTTP ${response.status}`);
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Stripe returned invalid data");
      return object(payload);
    }
    throw new Error("Stripe read failed");
  }
  const account = await read("account");
  if (account.id !== UKTL_STRIPE_ACCOUNT) throw new Error("Stripe account mismatch");
  async function collection(kind: "customers" | "charges" | "subscriptions"): Promise<Row[]> {
    const result: Row[] = [], seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({ limit: "100", ...(kind === "subscriptions" ? { status: "all" } : {}), ...(cursor ? { starting_after: cursor } : {}) });
      const payload = await read(`${kind}?${params}`);
      if (!Array.isArray(payload.data) || typeof payload.has_more !== "boolean" || (payload.has_more && !payload.data.length)) throw new Error("Stripe collection incomplete");
      for (const raw of payload.data) {
        const row = object(raw);
        if (typeof row.id !== "string" || seen.has(row.id) || row.livemode !== true) throw new Error("Stripe collection identity invalid");
        seen.add(row.id); result.push(row);
      }
      if (!payload.has_more) return result;
      cursor = String(result.at(-1)!.id);
      await sleep(200);
    }
    throw new Error("Stripe collection exceeded safe limit");
  }
  // Sequential calls keep quotas predictable and never create, collect, refund
  // or retry a payment. Raw customer details live only in this server request.
  const customers = await collection("customers"), charges = await collection("charges"), subscriptions = await collection("subscriptions");
  return { accountId: UKTL_STRIPE_ACCOUNT, livemode: true, complete: true, checkedAt: new Date().toISOString(), customers, charges, subscriptions };
}
