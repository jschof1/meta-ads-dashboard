// Secondary Meta event metrics. These deliberately stay separate from the
// configured Lead result: a CTA open shows intent, while a submitted form is
// an inquiry.

type StoredAction = {
  action_type?: unknown;
  value?: unknown;
};

type RawActionRow = {
  rawActions: string;
};

export type SecondaryEventMetric = {
  value: number | null;
  actionTypes: string[];
};

function parseActions(rawActions: string): StoredAction[] | null {
  try {
    const parsed: unknown = JSON.parse(rawActions);
    return Array.isArray(parsed) ? parsed.filter((action): action is StoredAction => typeof action === "object" && action !== null) : null;
  } catch {
    return null;
  }
}

function numericActionValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// The live UKTL page emits Meta's automatic `SubscribedButtonClick` event
// when a visitor opens the Request a callback form. Match that exact event
// name wherever Meta decorates it with an action-type prefix.
function isCallbackFormOpenAction(actionType: string): boolean {
  return actionType.toLowerCase().includes("subscribedbuttonclick");
}

/**
 * Sums the Meta-reported Request a callback form opens from account insight
 * rows. `null` means that Meta did not return readable action data, while 0
 * means that it did return action data but no matching event in the period.
 */
export function callbackFormOpens(rows: RawActionRow[]): SecondaryEventMetric {
  if (rows.length === 0) return { value: null, actionTypes: [] };

  let total = 0;
  const actionTypes = new Set<string>();
  for (const row of rows) {
    const actions = parseActions(row.rawActions);
    if (actions === null) return { value: null, actionTypes: [] };
    for (const action of actions) {
      if (typeof action.action_type !== "string" || !isCallbackFormOpenAction(action.action_type)) continue;
      const value = numericActionValue(action.value);
      if (value === null) return { value: null, actionTypes: [] };
      total += value;
      actionTypes.add(action.action_type);
    }
  }
  return { value: total, actionTypes: [...actionTypes].sort() };
}
