import { diagnoseResultEvents, type MetaInsightAction } from "./meta";

/** Reinterpret an older unknown result using its original provider receipt, never a new API call. */
export function recoverStoredResult(rawActions: string, storedType: string | null, configuredType: string | undefined): number | null {
  if (!configuredType || storedType !== configuredType) return null;
  let actions: unknown;
  try { actions = JSON.parse(rawActions); } catch { return null; }
  if (!Array.isArray(actions) || !actions.every(a => a && typeof a === "object" && typeof a.action_type === "string" && typeof a.value === "string" && a.value.trim() !== "" && Number.isFinite(Number(a.value)) && Number(a.value) >= 0)) return null;
  const result = diagnoseResultEvents({ actions: actions as MetaInsightAction[] }, { primaryActionType: configuredType });
  return result.needsConfiguration || result.value == null ? null : Math.round(result.value);
}
