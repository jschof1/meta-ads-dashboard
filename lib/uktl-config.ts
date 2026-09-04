// The single-business configuration for the UK Trade Leads command centre.
//
// Targets are intentionally nullable. They are business inputs, not safe
// defaults, so an unset target must remain visible as unknown in the product.

export type FunnelStageKey =
  | "lead"
  | "contacted"
  | "qualified"
  | "callBooked"
  | "callAttended"
  | "wonCustomer"
  | "lost";

export type FunnelStage = {
  key: FunnelStageKey;
  label: string;
  description: string;
  source: "meta" | "crm";
  displayInLinearFunnel: boolean;
};

export type MoneyTarget = {
  targetMinorUnits: number | null;
  acceptableMinorUnits: number | null;
  maximumMinorUnits: number | null;
};

export type RateTarget = {
  target: number | null;
  acceptable: number | null;
  minimum: number | null;
  maximum: number | null;
};

export type DecisionGate = {
  day: number;
  label: string;
  spendMinorUnits: number | null;
};

export type UKTLTargets = {
  dailyBudgetMinorUnits: number | null;
  monthlyBudgetMinorUnits: number | null;
  cpl: MoneyTarget;
  cpm: MoneyTarget;
  linkCtr: RateTarget;
  targetCacMinorUnits: number | null;
  learningLeadsPerWeek: number | null;
  decisionGates: readonly DecisionGate[];
};

export type UKTLConfig = {
  businessName: "UK Trade Leads";
  productName: string;
  locale: "en-GB";
  countryCode: "GB";
  currencySource: "Meta account";
  timezoneSource: "Meta account";
  funnel: readonly FunnelStage[];
  targets: UKTLTargets;
  evidence: {
    minLeadsForVerdict: number;
    minImpressionsForRate: number;
    minSpendMinorUnits: number | null;
    compareMatchedPeriods: true;
    unknownWhenMissing: true;
  };
  frequency: {
    watchAbove: number;
    alertAbove: number;
    ctrWatchBelow: number;
    ctrAlertBelow: number;
    interpretation: string;
  };
  brief: string;
};

export const UKTL_CONFIG = {
  businessName: "UK Trade Leads",
  productName: "UK Trade Leads Meta Ads Command Centre",
  locale: "en-GB",
  countryCode: "GB",
  currencySource: "Meta account",
  timezoneSource: "Meta account",
  funnel: [
    {
      key: "lead",
      label: "Lead",
      description: "A lead result reported by Meta.",
      source: "meta",
      displayInLinearFunnel: true,
    },
    {
      key: "contacted",
      label: "Contacted",
      description: "A CRM record with a recorded contact attempt.",
      source: "crm",
      displayInLinearFunnel: true,
    },
    {
      key: "qualified",
      label: "Qualified",
      description: "A CRM record explicitly marked as qualified.",
      source: "crm",
      displayInLinearFunnel: true,
    },
    {
      key: "callBooked",
      label: "Call booked",
      description: "A CRM record with a booked sales call.",
      source: "crm",
      displayInLinearFunnel: true,
    },
    {
      key: "callAttended",
      label: "Call attended",
      description: "A CRM record whose booked call was attended.",
      source: "crm",
      displayInLinearFunnel: true,
    },
    {
      key: "wonCustomer",
      label: "Won customer",
      description: "A CRM record explicitly marked as won.",
      source: "crm",
      displayInLinearFunnel: true,
    },
    {
      key: "lost",
      label: "Lost",
      description: "A CRM record explicitly marked as lost.",
      source: "crm",
      displayInLinearFunnel: false,
    },
  ],
  targets: {
    dailyBudgetMinorUnits: null,
    monthlyBudgetMinorUnits: null,
    cpl: {
      targetMinorUnits: null,
      acceptableMinorUnits: null,
      maximumMinorUnits: null,
    },
    cpm: {
      targetMinorUnits: null,
      acceptableMinorUnits: null,
      maximumMinorUnits: null,
    },
    linkCtr: {
      target: null,
      acceptable: null,
      minimum: null,
      maximum: null,
    },
    targetCacMinorUnits: null,
    learningLeadsPerWeek: null,
    decisionGates: [] as DecisionGate[],
  },
  evidence: {
    minLeadsForVerdict: 3,
    minImpressionsForRate: 1_000,
    minSpendMinorUnits: null,
    compareMatchedPeriods: true,
    unknownWhenMissing: true,
  },
  frequency: {
    watchAbove: 2,
    alertAbove: 3,
    // Diagnostic thresholds only; they are not performance targets.
    ctrWatchBelow: 0.015,
    ctrAlertBelow: 0.01,
    interpretation: "Frequency is a warning signal about audience saturation, not a verdict by itself.",
  },
  brief: `# UK Trade Leads conversion brief

## Purpose

This is the internal operating brief for the UK Trade Leads Meta Ads Command Centre. It covers one UK trades acquisition system, not a generic multi-client dashboard.

## Conversion system

Meta provides acquisition signals. The business outcome is lead quality through the CRM stages: lead, contacted, qualified, call booked, call attended, won customer, and lost.

## Operating principle

Lead quality beats raw lead volume. Meta-reported leads and CRM-attributed outcomes remain separate until the evidence supports a link between them.

## Measurement rules

Report spend and cost metrics in the currency returned by the Meta account, with en-GB formatting and the account timezone. Report leads, CPL, CPM, link CTR, CPC, and frequency. Preserve missing values as unknown and compare matched historical periods before drawing conclusions.

## Targets and budget

Targets, budget, and CAC are optional business inputs. No target is inferred when it has not been supplied, and historical comparisons remain available without them.

## Evidence boundary

Do not call a small sample conclusive. Frequency can prompt a review, but it cannot prove fatigue or lead quality. CRM attribution is only claimed at the granularity supported by the stored evidence.

## Privacy

Account and campaign identifiers are configured privately. This brief contains no credentials or live account values.
`,
} satisfies UKTLConfig;
