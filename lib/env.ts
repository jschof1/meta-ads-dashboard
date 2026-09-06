import { loadHighLevelSettings, type HighLevelConfigStatus } from "@/lib/highlevel-config";
import { isSecureRemoteDatabaseUrl } from "@/lib/database-url.mjs";

type Environment = Record<string, string | undefined>;

const MIN_SECRET_LENGTH = 32;

export type SafeEnvironmentStatus = {
  authentication: "configured" | "misconfigured";
  cron: "configured" | "misconfigured";
  database: "configured" | "misconfigured";
  meta: "configured" | "not_configured";
  ai: "configured" | "not_configured";
  crm: HighLevelConfigStatus;
};

function hasStrongSecret(value: string | undefined): boolean {
  return Boolean(value && value.length >= MIN_SECRET_LENGTH);
}

export function validateAuthEnvironment(env: Environment = process.env): string[] {
  const errors: string[] = [];
  if (!env.DASHBOARD_PASSWORD) errors.push("DASHBOARD_PASSWORD is required");
  if (!hasStrongSecret(env.AUTH_SECRET)) errors.push(`AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  return errors;
}

export function validateCronEnvironment(env: Environment = process.env): string[] {
  return hasStrongSecret(env.CRON_SECRET)
    ? []
    : [`CRON_SECRET must be at least ${MIN_SECRET_LENGTH} characters`];
}

function databaseUrl(env: Environment): string | null {
  const value = env.TURSO_DATABASE_URL?.trim() || env.DATABASE_URL?.trim();
  return value || null;
}

function isRemoteDatabaseUrl(value: string): boolean {
  return /^(?:libsql|https?):\/\//i.test(value);
}

export function validateDatabaseEnvironment(env: Environment = process.env): string[] {
  const url = databaseUrl(env);
  const errors: string[] = [];
  if (!url) errors.push("TURSO_DATABASE_URL or DATABASE_URL is required");
  if (url && isRemoteDatabaseUrl(url) && !env.TURSO_AUTH_TOKEN?.trim()) {
    errors.push("TURSO_AUTH_TOKEN is required for a remote libSQL database");
  }
  if (env.NODE_ENV === "production") {
    if (!env.TURSO_DATABASE_URL?.trim()) errors.push("TURSO_DATABASE_URL is required in production");
    if (!env.TURSO_AUTH_TOKEN?.trim()) errors.push("TURSO_AUTH_TOKEN is required in production");
    if (env.TURSO_DATABASE_URL?.trim() && !isSecureRemoteDatabaseUrl(env.TURSO_DATABASE_URL.trim())) {
      errors.push("TURSO_DATABASE_URL must be a valid remote libSQL URL with TLS enabled in production");
    }
  }
  return errors;
}

export function getSafeEnvironmentStatus(env: Environment = process.env): SafeEnvironmentStatus {
  return {
    authentication: validateAuthEnvironment(env).length === 0 ? "configured" : "misconfigured",
    cron: validateCronEnvironment(env).length === 0 ? "configured" : "misconfigured",
    database: validateDatabaseEnvironment(env).length === 0 ? "configured" : "misconfigured",
    meta: env.META_MARKETING_TOKEN && env.META_AD_ACCOUNT_ID ? "configured" : "not_configured",
    ai: env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
    crm: loadHighLevelSettings(env).status,
  };
}
