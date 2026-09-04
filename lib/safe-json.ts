const SENSITIVE_KEY = /(access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|cookie|password|secret|private[_-]?key|client[_-]?secret|token)/i;
const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const MAX_STRING_LENGTH = 8_000;
const SENSITIVE_STRING = /((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|cookie|password|secret|private[_-]?key|client[_-]?secret|token)["']?\s*[=:]\s*["']?)([^"'&\s,;}\]]+)/gi;

function redactString(value: string): string {
  return value
    .replace(SENSITIVE_STRING, "$1[REDACTED]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .slice(0, MAX_STRING_LENGTH);
}

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") {
    const redacted = redactString(value);
    return value.length > MAX_STRING_LENGTH ? `${redacted}...[TRUNCATED]` : redacted;
  }
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactSensitiveData(item, depth + 1));
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const output: Record<string, unknown> = {};
  for (const [key, item] of entries.slice(0, MAX_OBJECT_KEYS)) {
    output[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveData(item, depth + 1);
  }
  if (entries.length > MAX_OBJECT_KEYS) output._truncatedKeys = entries.length - MAX_OBJECT_KEYS;
  return output;
}

export function safeJson(value: unknown, fallback = "{}"): string {
  try {
    const encoded = JSON.stringify(redactSensitiveData(value));
    return encoded === undefined ? fallback : encoded;
  } catch {
    return fallback;
  }
}
