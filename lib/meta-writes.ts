// Legacy low-level helpers stay as hard guards. All supported mutations now go
// through lib/meta-actions.ts, which binds them to a stored recommendation,
// explicit approval, live-state checks and a one-shot audited execution. No
// ingestion or dashboard read path can call these helpers to issue a POST.

export class MetaWritesDisabledError extends Error {
  readonly name = "MetaWritesDisabledError";
}

function disabled(): never {
  throw new MetaWritesDisabledError("Use the approval-gated Meta action service; direct Meta writes are unavailable");
}

export async function pauseAd(adId: string): Promise<never> {
  void adId;
  return disabled();
}

export async function setAdsetBudget(adsetId: string, dailyCents: number): Promise<never> {
  void adsetId;
  void dailyCents;
  return disabled();
}
