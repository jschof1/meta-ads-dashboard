/**
 * The ordered migration names and their source checksums are embedded in the
 * diagnostics bundle so a deployed instance can compare its ledger with the
 * exact migration source used to build it.
 *
 * Update the checksum map whenever a new committed migration is added. The
 * migration utility calculates the same values directly from disk, while the
 * manifest makes the request-time check independent of serverless file
 * tracing.
 */
export const EXPECTED_MIGRATIONS = [
  "20260904170000_pr03_sync_data",
  "20260904193000_pr05_operator_dashboard",
  "20260904210000_pr06_recommendation_engine",
  "20260905120000_pr07_ai_briefings",
  "20260905133000_pr08_highlevel_attribution",
  "20260905143000_pr09_approved_meta_actions",
  "20260905160000_pr10_production_hardening",
] as const;

export const EXPECTED_MIGRATION_CHECKSUMS: Record<string, string> = {
  "20260904170000_pr03_sync_data": "d667a34b5ae011c532bf30f430e2f1ceb8d13c99a1e821468c3cb308f9e8f837",
  "20260904193000_pr05_operator_dashboard": "49d8f535dc65ad1a6cc4f933b49e8d8b9c64fc82eb52d9e939b24481f1a478c1",
  "20260904210000_pr06_recommendation_engine": "977bfdc7b4a05e44a53560adf621ae851506fc85cf3d13d0ff73ef61f25ec9e0",
  "20260905120000_pr07_ai_briefings": "aec620a302a8f710f27351714760cc8761566fe0e09fcf7b497a93d4ae712f35",
  "20260905133000_pr08_highlevel_attribution": "cba66ba6521aeb5e5bcfc8359bd718ec78d9167bbaa00ca93ac685dc39764531",
  "20260905143000_pr09_approved_meta_actions": "74fa2cbda628d545ef18934876d0232a055ae68ccf61e65fe225023053160f42",
  "20260905160000_pr10_production_hardening": "3bb38fc00c53d6ce7843d2aecc73de2f5e61dc2fbcd6eaf276ce24c4b3f8a94d",
};

export const CURRENT_SCHEMA_MIGRATION = EXPECTED_MIGRATIONS[EXPECTED_MIGRATIONS.length - 1];
