/**
 * Buyer intelligence derived from imported Sales Report data: repeat-buyer
 * segmentation, a summarized repeat-buyer persona, a high-potential prospect
 * profile, and per-customer recommended actions.
 *
 * Everything here is a pure function of AppData (plus the forecast groups the
 * dashboard already computes), so it is cheap to memoize and easy to test.
 * Only fields that exist in the Sales Report are used — nothing is invented.
 */
import type { AppData, Client } from "@/types";

/** A customer holding this many contracts or more is a repeat buyer. */
export const REPEAT_BUYER_MIN_CONTRACTS = 2;
/** Purchase anniversaries this many days out (or fewer) trigger a touchpoint. */
export const ANNIVERSARY_WINDOW_DAYS = 7;
/** A single-contract customer must meet this many prospect criteria to qualify. */
export const PROSPECT_MIN_CRITERIA = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ForecastGroups {
  approaching10: Client[];
  projected10Next30: Client[];
  nearCreq: Client[];
  inactive: Client[];
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export function isRepeatBuyer(client: Client): boolean {
  return client.contracts.length >= REPEAT_BUYER_MIN_CONTRACTS;
}

export type LifecycleStage = "Early Payment" | "Milestone-Reached" | "CREQ Complete";

export function lifecycleStage(client: Client): LifecycleStage {
  if (client.milestones_reached.includes("CREQ")) return "CREQ Complete";
  if (client.milestones_reached.includes("10% Payment") || client.payment_percentage >= 10) return "Milestone-Reached";
  return "Early Payment";
}

export interface CustomerBaseSummary {
  totalCustomers: number;
  repeatBuyers: number;
  /** Repeat buyers as a percentage (0–100) of all customers. */
  repeatBuyerShare: number;
  /** Mean total selling price (sum of a buyer's contract values) across repeat buyers. */
  avgRepeatBuyerTsp: number;
}

export function summarizeCustomerBase(clients: Client[]): CustomerBaseSummary {
  const repeat = clients.filter(isRepeatBuyer);
  return {
    totalCustomers: clients.length,
    repeatBuyers: repeat.length,
    repeatBuyerShare: clients.length > 0 ? (repeat.length / clients.length) * 100 : 0,
    avgRepeatBuyerTsp: mean(repeat.map((c) => c.contract_value)),
  };
}

// ---------------------------------------------------------------------------
// Repeat-buyer persona
// ---------------------------------------------------------------------------

export type CustomerValueTier = "High" | "Medium" | "Standard";
export type EngagementTrend = "Active" | "Mixed" | "Slowing";

export interface BuyerPersona {
  buyerType: "Repeat Buyer";
  /** Most frequent project among repeat buyers' contracts. */
  commonProject: string;
  /** Median number of contracts a repeat buyer holds. */
  typicalOwnership: number;
  customerValue: CustomerValueTier;
  engagementTrend: EngagementTrend;
  lifecycleStage: LifecycleStage;
  /** Number of repeat buyers the persona summarizes. */
  sampleSize: number;
}

/**
 * Summarizes the "typical" repeat buyer. Returns null when there are no repeat
 * buyers to summarize.
 *
 * - Customer value compares the repeat-buyer average TSP with the all-customer
 *   average: 1.5x or more is High, at or above average is Medium.
 * - Engagement trend is the share of repeat buyers flagged inactive:
 *   20% or less is Active, 50% or less is Mixed, otherwise Slowing.
 */
export function buildRepeatBuyerPersona(clients: Client[], inactiveIds: Set<string>): BuyerPersona | null {
  const repeat = clients.filter(isRepeatBuyer);
  if (repeat.length === 0) return null;

  const projectNames = repeat.flatMap((c) => c.contracts.map((k) => k.project_name || k.project_code));
  const valueRatio = safeRatio(mean(repeat.map((c) => c.contract_value)), mean(clients.map((c) => c.contract_value)));
  const inactiveShare = repeat.filter((c) => inactiveIds.has(c.id)).length / repeat.length;

  return {
    buyerType: "Repeat Buyer",
    commonProject: mode(projectNames.filter(Boolean)) ?? "—",
    typicalOwnership: Math.floor(median(repeat.map((c) => c.contracts.length))),
    customerValue: valueRatio >= 1.5 ? "High" : valueRatio >= 1 ? "Medium" : "Standard",
    engagementTrend: inactiveShare <= 0.2 ? "Active" : inactiveShare <= 0.5 ? "Mixed" : "Slowing",
    lifecycleStage: mode(repeat.map(lifecycleStage)) ?? "Early Payment",
    sampleSize: repeat.length,
  };
}

// ---------------------------------------------------------------------------
// High-potential prospect profile
// ---------------------------------------------------------------------------

export type ProspectCriterionId = "premium" | "payment_capacity" | "responsive" | "profile_match";

export interface ProspectCriterion {
  id: ProspectCriterionId;
  label: string;
  /** How many single-contract customers meet this criterion. */
  matches: number;
}

export interface ProspectProfile {
  /** Single-contract customers meeting at least PROSPECT_MIN_CRITERIA criteria. */
  prospects: Client[];
  criteria: ProspectCriterion[];
  /** Median contract value of repeat buyers' contracts — the "premium" bar. */
  premiumThreshold: number;
  /** Projects most common among repeat buyers (up to 3). */
  repeatBuyerProjects: string[];
}

const PROSPECT_LABELS: Record<ProspectCriterionId, string> = {
  premium: "Prefers premium offerings (contract value at or above the repeat-buyer median)",
  payment_capacity: "Strong payment capacity (10% payment reached)",
  responsive: "Responsive — payments still progressing (not inactive)",
  profile_match: "Matches buyer profile patterns (bought in a top repeat-buyer project)",
};

/**
 * Finds single-contract customers who look like existing repeat buyers and are
 * therefore likely to convert into repeat / high-value buyers.
 */
export function buildProspectProfile(clients: Client[], inactiveIds: Set<string>): ProspectProfile {
  const repeat = clients.filter(isRepeatBuyer);
  const singles = clients.filter((c) => !isRepeatBuyer(c));

  const premiumThreshold = median(repeat.flatMap((c) => c.contracts.map((k) => k.contract_value)));
  const repeatBuyerProjects = topN(
    repeat.flatMap((c) => c.contracts.map((k) => k.project_name || k.project_code)).filter(Boolean),
    3
  );
  const projectSet = new Set(repeatBuyerProjects);
  const hasRepeatBaseline = repeat.length > 0;

  const tests: Record<ProspectCriterionId, (c: Client) => boolean> = {
    premium: (c) => hasRepeatBaseline && c.contract_value >= premiumThreshold,
    payment_capacity: (c) => c.payment_percentage >= 10,
    responsive: (c) => !inactiveIds.has(c.id),
    profile_match: (c) => c.contracts.some((k) => projectSet.has(k.project_name || k.project_code)),
  };
  const ids = Object.keys(tests) as ProspectCriterionId[];

  const criteria = ids.map((id) => ({ id, label: PROSPECT_LABELS[id], matches: singles.filter(tests[id]).length }));
  const prospects = hasRepeatBaseline
    ? singles
        .filter((c) => ids.filter((id) => tests[id](c)).length >= PROSPECT_MIN_CRITERIA)
        .sort((a, b) => b.contract_value - a.contract_value)
    : [];

  return { prospects, criteria, premiumThreshold, repeatBuyerProjects };
}

// ---------------------------------------------------------------------------
// Customer priority & recommended actions
// ---------------------------------------------------------------------------

export type ActionFlag = "repeat_purchase" | "payment_milestone" | "relationship_touchpoint" | "inactive_engagement";
export type ActionPriority = "high" | "medium" | "low";

export interface CustomerFlag {
  flag: ActionFlag;
  priority: ActionPriority;
  keyIndicator: string;
  recommendedAction: string;
}

export interface CustomerAction {
  client: Client;
  /** Highest-priority flag; drives the row shown on the dashboard. */
  primary: CustomerFlag;
  /** Every flag raised for the customer, highest priority first. */
  flags: CustomerFlag[];
}

export const ACTION_FLAG_LABELS: Record<ActionFlag, string> = {
  repeat_purchase: "Repeat-Purchase Opportunity",
  payment_milestone: "Payment Milestone",
  relationship_touchpoint: "Relationship Touchpoint",
  inactive_engagement: "Inactive Engagement",
};

const PRIORITY_RANK: Record<ActionPriority, number> = { high: 0, medium: 1, low: 2 };
const FLAG_RANK: Record<ActionFlag, number> = {
  repeat_purchase: 0,
  payment_milestone: 1,
  relationship_touchpoint: 2,
  inactive_engagement: 3,
};

/**
 * Days until the next anniversary of a credit date, counted from `now` (UTC
 * calendar days). Returns null when the purchase is less than a year old,
 * since there is no anniversary to celebrate yet.
 */
export function daysUntilAnniversary(creditDateIso: string, now: Date): number | null {
  const credit = new Date(creditDateIso);
  if (Number.isNaN(credit.getTime())) return null;

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let year = now.getUTCFullYear();
  let next = anniversaryInYear(credit, year);
  if (next < today) next = anniversaryInYear(credit, ++year);
  if (year - credit.getUTCFullYear() < 1) return null;

  return Math.round((next - today) / DAY_MS);
}

function anniversaryInYear(credit: Date, year: number): number {
  // Feb 29 purchases celebrate on Feb 28 in non-leap years.
  const lastDay = new Date(Date.UTC(year, credit.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(year, credit.getUTCMonth(), Math.min(credit.getUTCDate(), lastDay));
}

export interface ActionContext {
  approaching: Set<string>;
  projected: Set<string>;
  inactive: Set<string>;
  /** Birthdate (YYYY-MM-DD) from the client's Purchase Application Form, if any. */
  birthdateOf: (client: Client) => string | undefined;
  now: Date;
}

export function buildActionContext(
  forecast: ForecastGroups,
  birthdateOf: (client: Client) => string | undefined = () => undefined,
  now: Date = new Date()
): ActionContext {
  return {
    approaching: new Set(forecast.approaching10.map((c) => c.id)),
    projected: new Set(forecast.projected10Next30.map((c) => c.id)),
    inactive: new Set(forecast.inactive.map((c) => c.id)),
    birthdateOf,
    now,
  };
}

/**
 * Raises action flags for one customer, highest priority first:
 *
 * | Flag                    | Rule                                                  | Priority |
 * |-------------------------|-------------------------------------------------------|----------|
 * | Repeat-Purchase         | Repeat buyer, 10% reached, not inactive               | High     |
 * | Payment Milestone       | Approaching 10% or projected to reach 10% in 30 days  | Medium   |
 * | Relationship Touchpoint | Birthday (from the PAF) or purchase anniversary       | Medium   |
 * |                         | within 7 days — whichever is sooner                   |          |
 * | Inactive Engagement     | No payment progress for 30+ days                      | Low      |
 */
export function flagsForClient(client: Client, ctx: ActionContext): CustomerFlag[] {
  const flags: CustomerFlag[] = [];

  if (isRepeatBuyer(client) && client.payment_percentage >= 10 && !ctx.inactive.has(client.id)) {
    flags.push({
      flag: "repeat_purchase",
      priority: "high",
      keyIndicator: `Existing repeat buyer (${client.contracts.length} properties)`,
      recommendedAction: "Personalized inventory check-in",
    });
  }

  if (ctx.approaching.has(client.id) || ctx.projected.has(client.id)) {
    flags.push({
      flag: "payment_milestone",
      priority: "medium",
      keyIndicator: ctx.approaching.has(client.id)
        ? `Approaching 10% payment (${client.payment_percentage.toFixed(1)}%)`
        : "On pace for 10% within 30 days",
      recommendedAction: "Congratulatory message and project update",
    });
  }

  const touchpoint = nearestTouchpoint(client, ctx);
  if (touchpoint !== null && touchpoint.days <= ANNIVERSARY_WINDOW_DAYS) {
    const { days, event } = touchpoint;
    flags.push({
      flag: "relationship_touchpoint",
      priority: "medium",
      keyIndicator: days === 0 ? `${event} today` : `${event} within ${days} day${days === 1 ? "" : "s"}`,
      recommendedAction: "Automated personalized greeting",
    });
  }

  if (ctx.inactive.has(client.id)) {
    flags.push({
      flag: "inactive_engagement",
      priority: "low",
      keyIndicator: "No payment progress for 30+ days",
      recommendedAction: "Relationship check-in",
    });
  }

  return flags.sort(compareFlags);
}

/**
 * Returns one entry per flagged customer, sorted by priority, then by total
 * contract value (largest first). See flagsForClient for the rules.
 */
export function computeCustomerActions(
  data: AppData,
  forecast: ForecastGroups,
  now: Date = new Date(),
  birthdateOf?: (client: Client) => string | undefined
): CustomerAction[] {
  const ctx = buildActionContext(forecast, birthdateOf, now);
  const actions: CustomerAction[] = [];
  for (const client of data.clients) {
    const flags = flagsForClient(client, ctx);
    if (flags.length > 0) actions.push({ client, primary: flags[0], flags });
  }
  return actions.sort(
    (a, b) => compareFlags(a.primary, b.primary) || b.client.contract_value - a.client.contract_value
  );
}

/**
 * Days until the next birthday, counted from `now` (UTC calendar days).
 * Returns null for a missing or unreadable birthdate.
 */
export function daysUntilBirthday(birthdateIso: string | undefined, now: Date): number | null {
  if (!birthdateIso) return null;
  const birth = new Date(`${birthdateIso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = anniversaryInYear(birth, now.getUTCFullYear());
  if (next < today) next = anniversaryInYear(birth, now.getUTCFullYear() + 1);
  return Math.round((next - today) / DAY_MS);
}

/** The sooner of the client's birthday and purchase anniversary; birthday wins a tie. */
function nearestTouchpoint(client: Client, ctx: ActionContext): { days: number; event: string } | null {
  const birthday = daysUntilBirthday(ctx.birthdateOf(client), ctx.now);
  const anniversary = nearestAnniversary(client, ctx.now);
  if (birthday !== null && (anniversary === null || birthday <= anniversary)) return { days: birthday, event: "Birthday" };
  if (anniversary !== null) return { days: anniversary, event: "Purchase anniversary" };
  return null;
}

function nearestAnniversary(client: Client, now: Date): number | null {
  const days = client.contracts
    .map((k) => daysUntilAnniversary(k.credit_date, now))
    .filter((d): d is number => d !== null);
  return days.length > 0 ? Math.min(...days) : null;
}

function compareFlags(a: CustomerFlag, b: CustomerFlag): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || FLAG_RANK[a.flag] - FLAG_RANK[b.flag];
}

// ---------------------------------------------------------------------------
// Small statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function safeRatio(a: number, b: number): number {
  return b > 0 ? a / b : 0;
}

/** Values ordered by frequency (ties keep first-seen order), truncated to n. */
function topN<T>(values: T[], n: number): T[] {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

function mode<T>(values: T[]): T | undefined {
  return topN(values, 1)[0];
}
