import {
  HIGHLEVEL_BASE_URL,
  HIGHLEVEL_API_VERSION,
  type HighLevelSettings,
} from "@/lib/highlevel-config";

const PAGE_SIZE = 100;
const MAX_RESPONSE_CHARS = 1_000_000;
const DEFAULT_MAX_RETRIES = 2;

export type HighLevelFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class HighLevelApiError extends Error {
  readonly name = "HighLevelApiError";
  readonly operation: string;
  readonly status: number | null;

  constructor(operation: string, status: number | null, message: string) {
    super(message);
    this.operation = operation;
    this.status = status;
  }
}

export type HighLevelPipelineStage = {
  id: string;
  name: string | null;
};

export type HighLevelPipeline = {
  id: string;
  locationId: string;
  stages: HighLevelPipelineStage[];
};

export type HighLevelCollection = {
  items: Record<string, unknown>[];
  providerTotal: number | null;
  truncated: boolean;
};

export type HighLevelClient = {
  listContacts(): Promise<HighLevelCollection>;
  listOpportunities(): Promise<HighLevelCollection>;
  getPipeline(): Promise<HighLevelPipeline>;
};

type ClientOptions = {
  config: HighLevelSettings;
  fetcher?: HighLevelFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObjectArray(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value)) return null;
  // A partially malformed provider page is not a valid snapshot. Filtering
  // bad rows would turn an upstream contract change into believable partial
  // data, so reject the whole page and fail closed instead.
  return value.every(isObject) ? value : null;
}

function payloadData(payload: Record<string, unknown>): Record<string, unknown> | null {
  return isObject(payload.data) ? payload.data : null;
}

function extractCollection(payload: Record<string, unknown>, key: string, operation: string): Record<string, unknown>[] {
  const data = payloadData(payload);
  const candidates = [payload[key], data?.[key], payload.data, data?.items, payload.items];
  for (const candidate of candidates) {
    const collection = asObjectArray(candidate);
    if (collection) return collection;
    if (Array.isArray(candidate)) {
      throw new HighLevelApiError(operation, null, `HighLevel ${operation} returned an invalid collection`);
    }
  }
  throw new HighLevelApiError(operation, null, `HighLevel ${operation} returned an invalid collection`);
}

function totalFrom(payload: Record<string, unknown>): number | null {
  const data = payloadData(payload);
  const meta = isObject(payload.meta) ? payload.meta : data && isObject(data.meta) ? data.meta : null;
  const candidates = [payload.total, data?.total, meta?.total, meta?.totalCount];
  for (const candidate of candidates) {
    const number = typeof candidate === "number" ? candidate : typeof candidate === "string" && /^\d+$/.test(candidate) ? Number(candidate) : null;
    if (number != null && Number.isSafeInteger(number) && number >= 0) return number;
  }
  return null;
}

function pipelineFrom(payload: Record<string, unknown>, operation: string): HighLevelPipeline {
  const data = payloadData(payload);
  const candidate = isObject(payload.pipeline) ? payload.pipeline : data && isObject(data.pipeline) ? data.pipeline : payload;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const locationId = typeof candidate.locationId === "string"
    ? candidate.locationId.trim()
    : typeof candidate.location_id === "string"
      ? candidate.location_id.trim()
      : "";
  const stagesValue = candidate.stages;
  if (!id || !locationId || !Array.isArray(stagesValue) || !stagesValue.every(isObject)) {
    throw new HighLevelApiError(operation, null, `HighLevel ${operation} returned an invalid pipeline`);
  }
  const stages = stagesValue
    .map((stage) => ({
      id: typeof stage.id === "string" ? stage.id.trim() : "",
      name: typeof stage.name === "string" ? stage.name.trim() : null,
    }))
    .filter((stage): stage is HighLevelPipelineStage => Boolean(stage.id));
  return { id, locationId, stages };
}

function retryAfterMilliseconds(response: Response): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(5_000, Math.round(seconds * 1_000)) : null;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function boundedPath(path: string): string {
  // All paths are assembled internally. Refuse an accidental absolute URL so
  // a provider response can never redirect the credential-bearing client.
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("HighLevel path must be an internal API path");
  }
  return path;
}

function redactToken(message: string, token: string): string {
  return message.replaceAll(token, "[REDACTED]").replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]");
}

export function createHighLevelClient(options: ClientOptions): HighLevelClient {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const maxRetries = Number.isInteger(options.maxRetries) && (options.maxRetries as number) >= 0
    ? Math.min(5, options.maxRetries as number)
    : DEFAULT_MAX_RETRIES;
  const token = options.config.token;
  if (!token) throw new HighLevelApiError("configuration", null, "HighLevel token is not configured");
  const accessToken = token;

  async function request(path: string, operation: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const url = new URL(boundedPath(path), HIGHLEVEL_BASE_URL).toString();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("Version", HIGHLEVEL_API_VERSION);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await fetcher(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        const message = error instanceof Error ? redactToken(error.message, accessToken) : "network error";
        if (attempt < maxRetries) {
          await sleep(Math.min(2_000, 250 * 2 ** attempt));
          continue;
        }
        throw new HighLevelApiError(operation, null, `HighLevel ${operation} request failed: ${message}`);
      }

      if (!response.ok) {
        if (isRetryable(response.status) && attempt < maxRetries) {
          await sleep(retryAfterMilliseconds(response) ?? Math.min(2_000, 250 * 2 ** attempt));
          continue;
        }
        throw new HighLevelApiError(operation, response.status, `HighLevel ${operation} returned HTTP ${response.status}`);
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        throw new HighLevelApiError(operation, response.status, `HighLevel ${operation} response could not be read`);
      }
      if (text.length > MAX_RESPONSE_CHARS) throw new HighLevelApiError(operation, response.status, `HighLevel ${operation} response exceeded the size limit`);
      try {
        const payload: unknown = JSON.parse(text);
        if (!isObject(payload)) throw new Error("not an object");
        return payload;
      } catch {
        throw new HighLevelApiError(operation, response.status, `HighLevel ${operation} returned malformed JSON`);
      }
    }
    throw new HighLevelApiError(operation, null, `HighLevel ${operation} request failed`);
  }

  async function listCollection(kind: "contacts" | "opportunities"): Promise<HighLevelCollection> {
    const result: Record<string, unknown>[] = [];
    const maxRecords = options.config.maxRecords;
    const operation = kind === "contacts" ? "contacts search" : "opportunities search";
    const maxPages = Math.ceil(maxRecords / PAGE_SIZE) + 1;
    let providerTotal: number | null = null;
    let truncated = false;
    for (let page = 1; page <= maxPages && result.length < maxRecords; page += 1) {
      const path = kind === "contacts"
        ? "/contacts/search"
        : `/opportunities/search?locationId=${encodeURIComponent(options.config.locationId as string)}&pipelineId=${encodeURIComponent(options.config.pipelineId as string)}&status=all&limit=${PAGE_SIZE}&page=${page}`;
      const payload = await request(path, operation, kind === "contacts"
        ? { method: "POST", body: JSON.stringify({ locationId: options.config.locationId, page, pageLimit: PAGE_SIZE }) }
        : { method: "GET" });
      const pageItems = extractCollection(payload, kind, operation);
      const pageTotal = totalFrom(payload);
      if (pageTotal != null) providerTotal = pageTotal;
      result.push(...pageItems.slice(0, Math.max(0, maxRecords - result.length)));
      if (result.length >= maxRecords && pageTotal != null && pageTotal > result.length) {
        truncated = true;
        break;
      }
      const providerHasMore = pageTotal != null && result.length < pageTotal;
      if (providerHasMore && pageItems.length < PAGE_SIZE) {
        // A short page is not proof of completion when the provider says that
        // more rows exist. Surface the snapshot as partial rather than
        // silently treating it as complete.
        truncated = true;
        break;
      }
      if (pageItems.length === 0 || pageItems.length < PAGE_SIZE || (pageTotal != null && result.length >= pageTotal)) break;
      if (result.length >= maxRecords) {
        // A full page at the configured cap is incomplete unless the provider
        // supplied a total proving that every row was fetched.
        truncated = pageTotal == null || pageTotal > result.length;
        break;
      }
    }
    return { items: result, providerTotal, truncated };
  }

  return {
    listContacts: () => listCollection("contacts"),
    listOpportunities: () => listCollection("opportunities"),
    async getPipeline(): Promise<HighLevelPipeline> {
      // The documented location-scoped collection works with existing read-only
      // CRM grants; the newer single-pipeline endpoint can require extra scopes.
      const payload = await request(`/opportunities/pipelines?locationId=${encodeURIComponent(options.config.locationId as string)}`, "pipeline read", { method: "GET" });
      const matches = extractCollection(payload, "pipelines", "pipeline read")
        .filter((pipeline) => pipeline.id === options.config.pipelineId);
      if (matches.length !== 1) throw new HighLevelApiError("pipeline read", null, "HighLevel did not return one unambiguous configured pipeline");
      const pipeline = pipelineFrom(matches[0], "pipeline read");
      if (pipeline.id !== options.config.pipelineId || pipeline.locationId !== options.config.locationId) {
        throw new HighLevelApiError("pipeline read", null, "HighLevel pipeline did not match the configured location or pipeline");
      }
      return pipeline;
    },
  };
}
