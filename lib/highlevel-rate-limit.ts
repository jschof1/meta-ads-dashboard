export type HighLevelRateLimit = {
  dailyLimit: number | null;
  dailyRemaining: number | null;
  intervalMs: number | null;
  shortLimit: number | null;
  shortRemaining: number | null;
  retryAfterMs: number | null;
};

function integerHeader(value: string | null): number | null {
  if (value == null || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function readHighLevelRateLimit(headers: Headers, now = Date.now()): HighLevelRateLimit {
  const retryAfter = headers.get("retry-after")?.trim() ?? null;
  let retryAfterMs: number | null = null;
  if (retryAfter != null && retryAfter !== "") {
    if (/^\d+(?:\.\d+)?$/.test(retryAfter)) {
      const milliseconds = Number(retryAfter) * 1_000;
      if (Number.isSafeInteger(Math.round(milliseconds))) retryAfterMs = Math.max(0, Math.round(milliseconds));
    } else {
      const date = Date.parse(retryAfter);
      if (Number.isFinite(date)) retryAfterMs = Math.max(0, date - now);
    }
  }
  return {
    dailyLimit: integerHeader(headers.get("x-ratelimit-limit-daily")),
    dailyRemaining: integerHeader(headers.get("x-ratelimit-daily-remaining")),
    intervalMs: integerHeader(headers.get("x-ratelimit-interval-milliseconds")),
    shortLimit: integerHeader(headers.get("x-ratelimit-max")),
    shortRemaining: integerHeader(headers.get("x-ratelimit-remaining")),
    retryAfterMs,
  };
}

export function highLevelRetryDelay(rate: HighLevelRateLimit): number | null {
  if (rate.dailyRemaining === 0) return null;
  if (rate.retryAfterMs != null) return rate.retryAfterMs;
  if (rate.shortRemaining === 0 && rate.intervalMs != null && rate.intervalMs > 0) return rate.intervalMs;
  if (rate.intervalMs != null && rate.intervalMs > 0) return rate.intervalMs;
  // Missing headers are unknown, not zero. On a 429 use a conservative window.
  return 10_000;
}

export type HighLevelFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Spaces every request in one enquiry import and stops issuing calls as soon as the provider reports no daily quota. */
export function createHighLevelPacedFetcher(
  fetcher: HighLevelFetcher = fetch,
  options: { minIntervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): HighLevelFetcher {
  const minIntervalMs = options.minIntervalMs ?? 250;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let queue = Promise.resolve();
  let nextRequestAt = 0;
  let dailyRemaining: number | null = null;

  return async (input, init) => {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (dailyRemaining === 0) return new Response("{}", { status: 429, headers: { "x-ratelimit-daily-remaining": "0" } });
      const wait = nextRequestAt - now();
      if (wait > 0) await sleep(wait);
      if (dailyRemaining === 0) return new Response("{}", { status: 429, headers: { "x-ratelimit-daily-remaining": "0" } });
      nextRequestAt = now() + minIntervalMs;
      const response = await fetcher(input, init);
      const observed = integerHeader(response.headers.get("x-ratelimit-daily-remaining"));
      if (observed != null) dailyRemaining = dailyRemaining == null ? observed : Math.min(dailyRemaining, observed);
      return response;
    } finally {
      release();
    }
  };
}
