// Meta mutations are intentionally unavailable until PR09's explicit approval
// architecture is implemented and enabled. Keeping these guards separate from
// the read client prevents accidental POST calls from ingestion code.

export class MetaWritesDisabledError extends Error {
  readonly name = "MetaWritesDisabledError";
}

function disabled(): never {
  throw new MetaWritesDisabledError("Meta write functionality is disabled until PR09 and explicit approval");
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
