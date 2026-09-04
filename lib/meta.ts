// Read-only Meta Graph API client.
//
// Authentication, retries, pagination and result interpretation live here so
// dashboard callers cannot accidentally implement a weaker API integration.

export const DEFAULT_GRAPH_VERSION = "v25.0";
const GRAPH_HOST = "graph.facebook.com";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;
const DEFAULT_MAX_ITEMS = 10_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 250;
const DEFAULT_BACKOFF_CAP_MS = 2_000;

type JsonObject = Record<string, unknown>;
type Fetcher = typeof fetch;
type Sleeper = (milliseconds: number) => Promise<void>;

export type MetaInsightAction = { action_type: string; value: string };

export type MetaInsightLevel = "account" | "campaign" | "adset" | "ad";

export type MetaInsightDateRange = {
  since: string;
  until: string;
};

export type MetaInsightRow = {
  account_id?: string;
  account_name?: string;
  campaign_name?: string;
  ad_id?: string;
  ad_name?: string;
  campaign_id?: string;
  adset_name?: string;
  adset_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  date_start?: string;
  date_stop?: string;
  actions?: MetaInsightAction[];
};

export type MetaRateLimitUsage = Record<string, number>;

export type MetaDiagnosticsUsage = Record<string, unknown>;

export type MetaDiagnostics = {
  attempts: number;
  traceId?: string;
  appUsage?: MetaRateLimitUsage;
  adAccountUsage?: MetaRateLimitUsage;
  insightsThrottle?: MetaDiagnosticsUsage;
  businessUseCaseUsage?: MetaDiagnosticsUsage;
  debug?: string;
  revision?: string;
  status?: number;
  code?: number;
  subcode?: number;
  type?: string;
  retryAfterMs?: number;
};

export type MetaRequestResult<T> = {
  data: T;
  paging?: MetaPaging;
  diagnostics: MetaDiagnostics;
};

export type MetaPaging = {
  cursors?: { before?: string; after?: string };
  next?: string;
};

export type MetaClientOptions = {
  token?: string;
  adAccountId?: string;
  graphVersion?: string;
  campaignId?: string;
  customConversionId?: string;
  primaryResultActionType?: string;
  attributionWindows?: string[];
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  backoffCapMs?: number;
  maxPages?: number;
  maxItems?: number;
  pageSize?: number;
  fetchImpl?: Fetcher;
  sleep?: Sleeper;
  random?: () => number;
};

export class MetaConfigurationError extends Error {
  readonly name = "MetaConfigurationError";

  constructor(message: string) {
    super(message);
  }
}

export type MetaErrorKind = "auth" | "rate_limit" | "transient" | "http" | "response";

export class MetaApiError extends Error {
  readonly name = "MetaApiError";
  readonly kind: MetaErrorKind;
  readonly status?: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly traceId?: string;
  readonly transient: boolean;
  readonly diagnostics: MetaDiagnostics;

  constructor(
    message: string,
    details: {
      kind: MetaErrorKind;
      status?: number;
      code?: number;
      subcode?: number;
      type?: string;
      traceId?: string;
      transient?: boolean;
      diagnostics?: MetaDiagnostics;
    },
  ) {
    super(message);
    this.kind = details.kind;
    this.status = details.status;
    this.code = details.code;
    this.subcode = details.subcode;
    this.type = details.type;
    this.traceId = details.traceId;
    this.transient = details.transient ?? false;
    this.diagnostics = details.diagnostics ?? { attempts: 1 };
  }
}

export class MetaPaginationError extends Error {
  readonly name = "MetaPaginationError";
}

export class MetaResultEventError extends Error {
  readonly name = "MetaResultEventError";
  readonly actionTypes: string[];

  constructor(message: string, actionTypes: string[] = []) {
    super(message);
    this.actionTypes = actionTypes;
  }
}

export type MetaAccount = {
  id: string;
  name?: string;
  account_status?: number;
  currency?: string;
  timezone_name?: string;
  timezone_offset_hours_utc?: number;
  business_name?: string;
};

export type MetaCampaign = {
  id: string;
  name?: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  start_time?: string;
  stop_time?: string;
};

export type MetaAdSet = {
  id: string;
  campaign_id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  learning_stage_info?: unknown;
};

export type AdSummary = {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id?: string;
  adset_id?: string;
  creative_id?: string;
  thumbnail_url?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  link_url?: string;
  object_url?: string;
  creative_raw?: unknown;
};

export type MetaCreative = {
  id: string;
  name?: string;
  title?: string;
  body?: string;
  call_to_action_type?: string;
  thumbnail_url?: string;
  image_hash?: string;
  image_url?: string;
  video_id?: string;
  object_id?: string;
  link_url?: string;
  object_url?: string;
  object_story_spec?: unknown;
  asset_feed_spec?: unknown;
  url_tags?: string;
  raw?: unknown;
};

export type MetaEntityDiscovery = {
  account: MetaAccount;
  campaigns: MetaCampaign[];
  adSets: MetaAdSet[];
  ads: AdSummary[];
  creatives: MetaCreative[];
};

export type MetaResultEventDiagnostic = {
  actionTypes: Array<{ actionType: string; count: number }>;
  actionTypeCounts: Record<string, number>;
  candidateActionTypes: string[];
  primaryActionType?: string;
  value: number | null;
  missing: boolean;
  ambiguous: boolean;
  needsConfiguration: boolean;
};

const FIELDS_AD = [
  "account_id",
  "account_name",
  "ad_id",
  "ad_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "date_start",
  "date_stop",
  "actions",
].join(",");

const FIELDS_AGGREGATE = [
  "account_id",
  "account_name",
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "frequency",
  "actions",
].join(",");

const ENTITY_FIELDS = {
  account: "id,name,account_status,currency,timezone_name,timezone_offset_hours_utc,business_name",
  campaigns: "id,name,objective,status,effective_status,start_time,stop_time",
  adSets: "id,campaign_id,name,status,effective_status,optimization_goal,billing_event,daily_budget,lifetime_budget,start_time,end_time,learning_stage_info",
  ads: "id,name,status,effective_status,campaign_id,adset_id,creative{id,thumbnail_url,image_hash,image_url,video_id,link_url,object_url,object_story_spec,asset_feed_spec}",
  creatives: "id,name,title,body,call_to_action_type,thumbnail_url,image_hash,image_url,video_id,object_id,link_url,object_url,object_story_spec,asset_feed_spec,url_tags",
} as const;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return parseJsonText(await response.text());
    } catch {
      return undefined;
    }
  }
}

function parseUsageHeader(value: string | null): MetaRateLimitUsage | undefined {
  if (!value) return undefined;
  const parsed = parseJsonText(value);
  if (!isObject(parsed)) return undefined;
  const usage = Object.fromEntries(
    Object.entries(parsed)
      .map(([key, item]) => [key, numberValue(item)] as const)
      .filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function parseObjectHeader(value: string | null): MetaDiagnosticsUsage | undefined {
  if (!value) return undefined;
  const parsed = parseJsonText(value);
  return isObject(parsed) ? parsed : undefined;
}

function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1_000));
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

function redactedMessage(value: string, token: string): string {
  return value.replaceAll(token, "[REDACTED]").replace(/access_token=[^&\s]+/gi, "access_token=[REDACTED]");
}

function graphError(body: unknown): JsonObject | undefined {
  if (!isObject(body) || !isObject(body.error)) return undefined;
  return body.error;
}

function isRateLimit(code?: number, status?: number): boolean {
  return status === 429 || code === 4 || code === 17 || code === 32 || code === 613;
}

function isAuthFailure(code?: number, status?: number): boolean {
  return status === 401 || code === 102 || code === 190;
}

function isRetryableStatus(status?: number): boolean {
  return status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normaliseAccountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new MetaConfigurationError("META_AD_ACCOUNT_ID is required");
  return trimmed;
}

function normaliseVersion(value: string | undefined): string {
  const version = (value || DEFAULT_GRAPH_VERSION).trim();
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new MetaConfigurationError("META_GRAPH_VERSION must look like v25.0");
  }
  return version;
}

function windowToParams(window: string): Record<string, string> {
  const match = window.match(/^last_(\d+)d$/);
  if (!match) return { date_preset: window };
  const days = Number(match[1]);
  if (!Number.isInteger(days) || days < 1) return { date_preset: window };
  const today = new Date();
  const since = new Date(today);
  since.setUTCDate(since.getUTCDate() - (days - 1));
  const format = (date: Date) => date.toISOString().slice(0, 10);
  return { time_range: JSON.stringify({ since: format(since), until: format(today) }) };
}

function accountPath(accountId: string): string {
  return accountId.startsWith("act_") ? accountId : `act_${accountId}`;
}

export class MetaClient {
  private readonly token: string;
  private readonly accountId: string;
  private readonly graphVersion: string;
  private readonly campaignId?: string;
  private readonly customConversionId?: string;
  private readonly attributionWindows: string[];
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly backoffCapMs: number;
  private readonly maxPages: number;
  private readonly maxItems: number;
  private readonly pageSize: number;
  private readonly fetchImpl: Fetcher;
  private readonly sleep: Sleeper;
  private readonly random: () => number;
  private readonly primaryResultActionType?: string;
  private lastDiagnostics: MetaDiagnostics = { attempts: 0 };

  constructor(options: MetaClientOptions = {}) {
    const configuredToken = options.token ?? process.env.META_MARKETING_TOKEN;
    if (!configuredToken?.trim()) throw new MetaConfigurationError("META_MARKETING_TOKEN is required");
    this.token = configuredToken.trim();
    this.accountId = normaliseAccountId(options.adAccountId ?? process.env.META_AD_ACCOUNT_ID ?? "");
    this.graphVersion = normaliseVersion(options.graphVersion ?? process.env.META_GRAPH_VERSION);
    this.campaignId = options.campaignId ?? process.env.META_CAMPAIGN_ID ?? undefined;
    this.customConversionId = options.customConversionId ?? process.env.META_CUSTOM_CONVERSION_ID ?? undefined;
    this.primaryResultActionType = options.primaryResultActionType ?? process.env.META_PRIMARY_RESULT_ACTION_TYPE ?? undefined;
    this.attributionWindows = options.attributionWindows
      ?? process.env.META_ATTRIBUTION_WINDOWS?.split(",").map((value) => value.trim()).filter(Boolean)
      ?? ["7d_click", "1d_view"];
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.backoffCapMs = options.backoffCapMs ?? DEFAULT_BACKOFF_CAP_MS;
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? sleep;
    this.random = options.random ?? Math.random;
  }

  private url(path: string, params: Record<string, string | undefined>): URL {
    const url = new URL(`https://${GRAPH_HOST}/${this.graphVersion}/${path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    return url;
  }

  private async requestRaw<T>(path: string, params: Record<string, string | undefined>): Promise<MetaRequestResult<T>> {
    const url = this.url(path, params);
    let attempt = 0;

    while (true) {
      attempt += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url.toString(), {
          method: "GET",
          cache: "no-store",
          headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" },
          signal: controller.signal,
        });
        const diagnostics: MetaDiagnostics = {
          attempts: attempt,
          traceId: response.headers.get("x-fb-trace-id") ?? undefined,
          appUsage: parseUsageHeader(response.headers.get("x-app-usage")),
          adAccountUsage: parseUsageHeader(response.headers.get("x-ad-account-usage")),
          insightsThrottle: parseObjectHeader(response.headers.get("x-fb-ads-insights-throttle")),
          businessUseCaseUsage: parseObjectHeader(response.headers.get("x-business-use-case-usage")),
          debug: response.headers.get("x-fb-debug") ?? undefined,
          revision: response.headers.get("x-fb-rev") ?? undefined,
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
        };
        this.lastDiagnostics = diagnostics;
        const body = await readBody(response);
        const error = graphError(body);
        if (!response.ok || error) {
          if (!diagnostics.traceId) diagnostics.traceId = stringValue(error?.fbtrace_id);
          const code = numberValue(error?.code);
          diagnostics.code = code;
          diagnostics.subcode = numberValue(error?.error_subcode);
          diagnostics.type = stringValue(error?.type);
          const kind: MetaErrorKind = isAuthFailure(code, response.status)
            ? "auth"
            : isRateLimit(code, response.status)
              ? "rate_limit"
              : isRetryableStatus(response.status) || error?.is_transient === true
                ? "transient"
                : "http";
          const apiError = new MetaApiError(
            redactedMessage(stringValue(error?.message) ?? `Meta Graph API request failed with HTTP ${response.status}`, this.token),
            {
              kind,
              status: response.status,
              code,
              subcode: numberValue(error?.error_subcode),
              type: stringValue(error?.type),
              traceId: diagnostics.traceId,
              transient: kind === "transient" || kind === "rate_limit",
              diagnostics,
            },
          );
          if (this.shouldRetry(apiError, attempt)) {
            await this.waitBeforeRetry(apiError, attempt);
            continue;
          }
          throw apiError;
        }
        if (!isObject(body)) {
          throw new MetaApiError("Meta Graph API returned a malformed JSON response", {
            kind: "response",
            status: response.status,
            traceId: diagnostics.traceId,
            diagnostics,
          });
        }
        return {
          data: ("data" in body ? body.data : body) as T,
          paging: parsePaging(body.paging),
          diagnostics,
        };
      } catch (error) {
        if (error instanceof MetaApiError) {
          if (this.shouldRetry(error, attempt)) {
            await this.waitBeforeRetry(error, attempt);
            continue;
          }
          throw error;
        }
        const networkError = new MetaApiError(
          controller.signal.aborted ? `Meta Graph API request timed out after ${this.timeoutMs}ms` : "Meta Graph API network request failed",
          { kind: "transient", transient: true, diagnostics: { attempts: attempt } },
        );
        this.lastDiagnostics = networkError.diagnostics;
        if (this.shouldRetry(networkError, attempt)) {
          await this.waitBeforeRetry(networkError, attempt);
          continue;
        }
        throw networkError;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private shouldRetry(error: MetaApiError, attempt: number): boolean {
    return error.transient && attempt <= this.maxRetries;
  }

  private async waitBeforeRetry(error: MetaApiError, attempt: number): Promise<void> {
    const exponential = Math.min(this.backoffCapMs, this.backoffMs * 2 ** (attempt - 1));
    await this.sleep(error.diagnostics.retryAfterMs ?? Math.round(exponential + exponential * 0.2 * this.random()));
  }

  async request<T>(path: string, params: Record<string, string | undefined> = {}): Promise<MetaRequestResult<T>> {
    return this.requestRaw<T>(path, params);
  }

  async paginate<T>(path: string, params: Record<string, string | undefined> = {}): Promise<MetaRequestResult<T[]>> {
    const items: T[] = [];
    let after: string | undefined;
    let pages = 0;
    let lastDiagnostics: MetaDiagnostics = { attempts: 0 };
    let lastPaging: MetaPaging | undefined;

    while (true) {
      if (pages >= this.maxPages) throw new MetaPaginationError(`Meta pagination exceeded the ${this.maxPages}-page safety cap`);
      const page = await this.requestRaw<T[]>(path, {
        ...params,
        limit: String(this.pageSize),
        ...(after ? { after } : {}),
      });
      if (!Array.isArray(page.data)) {
        throw new MetaApiError("Meta Graph API returned a malformed collection", {
          kind: "response",
          traceId: page.diagnostics.traceId,
          diagnostics: page.diagnostics,
        });
      }
      if (items.length + page.data.length > this.maxItems) {
        throw new MetaPaginationError(`Meta pagination exceeded the ${this.maxItems}-item safety cap`);
      }
      items.push(...page.data);
      pages += 1;
      lastDiagnostics = page.diagnostics;
      lastPaging = page.paging;
      // Meta's cursor object describes the current page; only a valid next URL
      // is an instruction to continue. In particular, do not follow a stale
      // `cursors.after` on a terminal page.
      const next = cursorFromNext(page.paging?.next, page.paging?.cursors?.after, path, this.graphVersion);
      if (!next) break;
      if (next === after) throw new MetaPaginationError("Meta pagination returned the same cursor twice");
      after = next;
    }

    return { data: items, paging: lastPaging, diagnostics: lastDiagnostics };
  }

  async getAccount(): Promise<MetaAccount> {
    const result = await this.request<MetaAccount>(accountPath(this.accountId), { fields: ENTITY_FIELDS.account });
    if (!isObject(result.data) || typeof result.data.id !== "string") {
      throw new MetaApiError("Meta account response did not include an id", { kind: "response", diagnostics: result.diagnostics });
    }
    return result.data as MetaAccount;
  }

  async listCampaigns(): Promise<MetaCampaign[]> {
    return (await this.paginate<MetaCampaign>(`${accountPath(this.accountId)}/campaigns`, { fields: ENTITY_FIELDS.campaigns })).data;
  }

  async listAdSets(campaignId?: string): Promise<MetaAdSet[]> {
    const path = campaignId ? `${campaignId}/adsets` : `${accountPath(this.accountId)}/adsets`;
    return (await this.paginate<MetaAdSet>(path, { fields: ENTITY_FIELDS.adSets })).data;
  }

  async listAds(campaignId?: string): Promise<AdSummary[]> {
    const path = campaignId ? `${campaignId}/ads` : `${accountPath(this.accountId)}/ads`;
    return (await this.paginate<RawAd>(path, { fields: ENTITY_FIELDS.ads })).data.map(toAdSummary);
  }

  async listCreatives(): Promise<MetaCreative[]> {
    return (await this.paginate<RawCreative>(`${accountPath(this.accountId)}/adcreatives`, { fields: ENTITY_FIELDS.creatives })).data.map(toCreative);
  }

  async discoverEntities(): Promise<MetaEntityDiscovery> {
    const account = await this.getAccount();
    const [campaigns, adSets, ads, creatives] = await Promise.all([
      this.listCampaigns(),
      this.listAdSets(),
      this.listAds(),
      this.listCreatives(),
    ]);
    return { account, campaigns, adSets, ads, creatives };
  }

  private insightParams(window: string, level: "account" | "ad"): Record<string, string | undefined> {
    return {
      level,
      ...windowToParams(window),
      filtering: this.campaignId
        ? JSON.stringify([{ field: "campaign.id", operator: "IN", value: [this.campaignId] }])
        : undefined,
      action_attribution_windows: JSON.stringify(this.attributionWindows),
      action_report_time: "conversion",
    };
  }

  private insightParamsForRange(range: MetaInsightDateRange, level: MetaInsightLevel): Record<string, string | undefined> {
    return {
      level,
      time_range: JSON.stringify(range),
      filtering: this.campaignId
        ? JSON.stringify([{ field: "campaign.id", operator: "IN", value: [this.campaignId] }])
        : undefined,
      action_attribution_windows: JSON.stringify(this.attributionWindows),
      action_report_time: "conversion",
    };
  }

  async getAccountRollup(window: string): Promise<MetaInsightRow | null> {
    const result = await this.paginate<MetaInsightRow>(`${accountPath(this.accountId)}/insights`, {
      ...this.insightParams(window, "account"),
      fields: FIELDS_AGGREGATE,
    });
    return result.data[0] ?? null;
  }

  async getAdDaily(window: string): Promise<MetaInsightRow[]> {
    return (await this.paginate<MetaInsightRow>(`${accountPath(this.accountId)}/insights`, {
      ...this.insightParams(window, "ad"),
      fields: FIELDS_AD,
      time_increment: "1",
    })).data;
  }

  async getAdCumulative(window: string): Promise<MetaInsightRow[]> {
    return (await this.paginate<MetaInsightRow>(`${accountPath(this.accountId)}/insights`, {
      ...this.insightParams(window, "ad"),
      fields: FIELDS_AD,
    })).data;
  }

  async getAccountTimeseries(window: string): Promise<MetaInsightRow[]> {
    return (await this.paginate<MetaInsightRow>(`${accountPath(this.accountId)}/insights`, {
      ...this.insightParams(window, "account"),
      fields: FIELDS_AGGREGATE,
      time_increment: "1",
    })).data;
  }

  async getDailyInsights(level: MetaInsightLevel, range: MetaInsightDateRange): Promise<MetaInsightRow[]> {
    return (await this.paginate<MetaInsightRow>(`${accountPath(this.accountId)}/insights`, {
      ...this.insightParamsForRange(range, level),
      fields: level === "account" ? FIELDS_AGGREGATE : FIELDS_AD,
      time_increment: "1",
    })).data;
  }

  getAccountId(): string {
    return this.accountId;
  }

  getGraphVersion(): string {
    return this.graphVersion;
  }

  getAttributionKey(): string {
    return this.attributionWindows.join(",");
  }

  getDiagnostics(): MetaDiagnostics {
    return this.lastDiagnostics;
  }

  diagnoseResultEvents(row: MetaInsightRow): MetaResultEventDiagnostic {
    return diagnoseResultEvents(row, {
      primaryActionType: this.primaryResultActionType,
      customConversionId: this.customConversionId,
    });
  }

  extractResultEvents(row: MetaInsightRow): MetaResultEventDiagnostic {
    const diagnostic = this.diagnoseResultEvents(row);
    if (diagnostic.needsConfiguration) {
      throw new MetaResultEventError(
        "result event needs configuration: set META_PRIMARY_RESULT_ACTION_TYPE",
        diagnostic.candidateActionTypes,
      );
    }
    return diagnostic;
  }

  extractRegistrations(row: MetaInsightRow): number {
    return this.extractResultEvents(row).value ?? 0;
  }
}

type RawAd = {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: {
    id?: string;
    thumbnail_url?: string;
    image_hash?: string;
    image_url?: string;
    video_id?: string;
    link_url?: string;
    object_url?: string;
    object_story_spec?: unknown;
    asset_feed_spec?: unknown;
  };
};

type RawCreative = Omit<MetaCreative, "raw">;

function toCreative(creative: RawCreative): MetaCreative {
  return { ...creative, raw: creative };
}

function toAdSummary(ad: RawAd): AdSummary {
  return {
    id: ad.id ?? "",
    name: ad.name ?? ad.id ?? "",
    status: ad.status ?? "UNKNOWN",
    effective_status: ad.effective_status ?? "UNKNOWN",
    campaign_id: ad.campaign_id,
    adset_id: ad.adset_id,
    creative_id: ad.creative?.id,
    thumbnail_url: ad.creative?.thumbnail_url,
    image_hash: ad.creative?.image_hash,
    image_url: ad.creative?.image_url,
    video_id: ad.creative?.video_id,
    link_url: ad.creative?.link_url,
    object_url: ad.creative?.object_url,
    creative_raw: ad.creative,
  };
}

function parsePaging(value: unknown): MetaPaging | undefined {
  if (!isObject(value)) return undefined;
  const cursors = isObject(value.cursors)
    ? { before: stringValue(value.cursors.before), after: stringValue(value.cursors.after) }
    : undefined;
  const next = stringValue(value.next);
  return cursors || next ? { cursors, next } : undefined;
}

function cursorFromNext(
  next: string | undefined,
  cursorAfter: string | undefined,
  expectedPath: string,
  graphVersion: string,
): string | undefined {
  if (!next) return undefined;
  try {
    const url = new URL(next);
    if (url.protocol !== "https:") throw new MetaPaginationError("Meta pagination returned an unsafe protocol");
    if (url.hostname !== GRAPH_HOST) throw new MetaPaginationError("Meta pagination returned an unexpected host");
    const expected = `/${graphVersion}/${expectedPath.replace(/^\/+/, "")}`;
    if (url.pathname !== expected) throw new MetaPaginationError("Meta pagination returned an unexpected endpoint");
    const cursor = url.searchParams.get("after") ?? cursorAfter;
    if (!cursor) throw new MetaPaginationError("Meta pagination next URL did not contain an after cursor");
    return cursor;
  } catch (error) {
    if (error instanceof MetaPaginationError) throw error;
    throw new MetaPaginationError("Meta pagination returned an invalid next URL");
  }
}

const KNOWN_NON_RESULT_ACTIONS = new Set([
  "clicks",
  "impressions",
  "link_click",
  "landing_page_view",
  "outbound_click",
  "post_engagement",
  "page_engagement",
  "video_view",
]);

function actionRows(row: MetaInsightRow): MetaInsightAction[] {
  if (!Array.isArray(row.actions)) return [];
  return row.actions.flatMap((action) => {
    if (!isObject(action) || typeof action.action_type !== "string") return [];
    const value = typeof action.value === "number" && Number.isFinite(action.value)
      ? String(action.value)
      : typeof action.value === "string"
        ? action.value
        : "0";
    return [{ action_type: action.action_type, value }];
  });
}

function actionTypeCounts(actions: MetaInsightAction[]): Record<string, number> {
  return actions.reduce<Record<string, number>>((counts, action) => {
    const count = Number(action.value);
    counts[action.action_type] = (counts[action.action_type] ?? 0) + (Number.isFinite(count) ? count : 0);
    return counts;
  }, {});
}

function isResultActionType(actionType: string): boolean {
  const value = actionType.toLowerCase();
  return !KNOWN_NON_RESULT_ACTIONS.has(value) && (
    value.includes("lead") ||
    value.includes("registration") ||
    value.includes("conversion.custom") ||
    value.includes("custom_event")
  );
}

export function diagnoseResultEvents(
  row: MetaInsightRow,
  options: { primaryActionType?: string; customConversionId?: string } = {},
): MetaResultEventDiagnostic {
  const actions = actionRows(row);
  const actionTypeCountsByName = actionTypeCounts(actions);
  const actionTypes = Object.entries(actionTypeCountsByName).map(([actionType, count]) => ({ actionType, count }));
  const candidateActionTypes = actionTypes.map(({ actionType }) => actionType).filter(isResultActionType);
  const configuredCustom = options.customConversionId ? `offsite_conversion.custom.${options.customConversionId}` : undefined;
  const primaryActionType = options.primaryActionType || configuredCustom || (candidateActionTypes.length === 1 ? candidateActionTypes[0] : undefined);
  const needsConfiguration = !options.primaryActionType && !configuredCustom && (candidateActionTypes.length === 0 || candidateActionTypes.length > 1);
  const ambiguous = candidateActionTypes.length > 1 && !options.primaryActionType && !configuredCustom;
  const match = primaryActionType ? actions.find((action) => action.action_type === primaryActionType) : undefined;
  const value = match ? Number(match.value) : null;
  return {
    actionTypes,
    actionTypeCounts: actionTypeCountsByName,
    candidateActionTypes,
    primaryActionType,
    value: match && Number.isFinite(value) ? value : null,
    missing: !match,
    ambiguous,
    needsConfiguration,
  };
}

export function extractResultEvents(
  row: MetaInsightRow,
  options: { primaryActionType?: string; customConversionId?: string } = {},
): MetaResultEventDiagnostic {
  const diagnostic = diagnoseResultEvents(row, options);
  if (diagnostic.needsConfiguration) {
    throw new MetaResultEventError(
      "result event needs configuration: set META_PRIMARY_RESULT_ACTION_TYPE",
      diagnostic.candidateActionTypes,
    );
  }
  return diagnostic;
}

export function extractRegistrations(row: MetaInsightRow): number {
  const diagnostic = extractResultEvents(row, {
    primaryActionType: process.env.META_PRIMARY_RESULT_ACTION_TYPE || undefined,
    customConversionId: process.env.META_CUSTOM_CONVERSION_ID || undefined,
  });
  return diagnostic.value ?? 0;
}

export function toCents(money: string | undefined | null): number {
  return toOptionalCents(money) ?? 0;
}

export function toFloat(value: string | undefined | null): number {
  return toOptionalFloat(value) ?? 0;
}

export function toInt(value: string | undefined | null): number {
  return toOptionalInt(value) ?? 0;
}

export function toOptionalCents(money: string | number | undefined | null): number | null {
  if (money === undefined || money === null || String(money).trim() === "") return null;
  const number = typeof money === "number" ? money : Number.parseFloat(money);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export function toOptionalFloat(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

export function toOptionalInt(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

export function createMetaClient(options: MetaClientOptions = {}): MetaClient {
  return new MetaClient(options);
}

function configuredClient(): MetaClient {
  return createMetaClient();
}

export async function getAccountRollup(window: string): Promise<MetaInsightRow | null> {
  return configuredClient().getAccountRollup(window);
}

export async function getAdDaily(window: string): Promise<MetaInsightRow[]> {
  return configuredClient().getAdDaily(window);
}

export async function getAdCumulative(window: string): Promise<MetaInsightRow[]> {
  return configuredClient().getAdCumulative(window);
}

export async function getAccountTimeseries(window: string): Promise<MetaInsightRow[]> {
  return configuredClient().getAccountTimeseries(window);
}

export async function getDailyInsights(level: MetaInsightLevel, range: MetaInsightDateRange): Promise<MetaInsightRow[]> {
  return configuredClient().getDailyInsights(level, range);
}

export async function listCampaignAds(): Promise<AdSummary[]> {
  return configuredClient().listAds(process.env.META_CAMPAIGN_ID || undefined);
}

export async function discoverMetaEntities(): Promise<MetaEntityDiscovery> {
  return configuredClient().discoverEntities();
}

export async function listCampaigns(): Promise<MetaCampaign[]> {
  return configuredClient().listCampaigns();
}

export async function listAdSets(campaignId?: string): Promise<MetaAdSet[]> {
  return configuredClient().listAdSets(campaignId);
}

export async function listAds(campaignId?: string): Promise<AdSummary[]> {
  return configuredClient().listAds(campaignId);
}

export async function listCreatives(): Promise<MetaCreative[]> {
  return configuredClient().listCreatives();
}
