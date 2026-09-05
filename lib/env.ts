import { loadHighLevelSettings, type HighLevelConfigStatus } from "@/lib/highlevel-config";

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

export function getSafeEnvironmentStatus(env: Environment = process.env): SafeEnvironmentStatus {
  return {
    authentication: validateAuthEnvironment(env).length === 0 ? "configured" : "misconfigured",
    cron: validateCronEnvironment(env).length === 0 ? "configured" : "misconfigured",
    database: env.DATABASE_URL || env.TURSO_DATABASE_URL ? "configured" : "misconfigured",
    meta: env.META_MARKETING_TOKEN && env.META_AD_ACCOUNT_ID ? "configured" : "not_configured",
    ai: env.ANTHROPIC_API_KEY ? "configured" : "not_configured",
    crm: loadHighLevelSettings(env).status,
  };
}
