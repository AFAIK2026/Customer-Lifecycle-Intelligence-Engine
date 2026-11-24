/**
 * Client side of the Python prospect analysis (design: docs/design/prospect-analysis-python.md §10).
 *
 * Builds the anonymised request (client ids and contract figures only: never
 * names, documents or PAF details), fingerprints it so the analysis only reruns
 * when the data changes, and validates the response before the UI trusts it.
 */
import type { Client } from "@/types";

export const PROSPECT_ANALYSIS_URL = "/api/prospect-analysis";
/** Give up and show the rule-based profile after this long (the Vercel function is capped at 15 s). */
export const PROSPECT_ANALYSIS_TIMEOUT_MS = 20_000;

export interface ProspectContractPayload {
  contract_number: string;
  project_code: string;
  project_name: string;
  credit_date: string;
  contract_value: number;
  payment_percentage: number;
}

export interface ProspectAnalysisRequest {
  as_of: string;
  customers: { ref: string; contracts: ProspectContractPayload[] }[];
}

export type ProspectAnalysisStatus = "ok" | "insufficient_data" | "weak_signal";

export interface ProspectDriver {
  feature: string;
  label: string;
  odds_ratio: number;
  ci_low: number;
  ci_high: number;
  direction: "up" | "down";
  statement: string;
}

export interface ScoredProspect {
  /** The client's id. */
  ref: string;
  probability: number;
  lift: number;
  tier: "high" | "promising";
  reasons: string[];
}

export interface ProspectAnalysisResponse {
  status: ProspectAnalysisStatus;
  model: {
    version: string;
    method: string;
    trained_on: { repeat: number; single: number };
    excluded_recent: number;
    base_rate: number | null;
    cv_auc: number | null;
    cv_folds: number;
    reference_project: string | null;
    analysed_at?: string;
  };
  drivers: ProspectDriver[];
  prospects: ScoredProspect[];
  summary: { scored: number; high: number; promising: number };
}

/**
 * Builds the request body. Contracts the API would reject (no value, future
 * credit date) are left out rather than failing the whole analysis, and
 * payment percentages are clipped to 0–100.
 */
export function buildProspectRequest(clients: Client[], now: Date = new Date()): ProspectAnalysisRequest {
  const asOf = now.toISOString();
  const customers = [];
  for (const client of clients) {
    const contracts = client.contracts
      .filter((c) => c.contract_value > 0 && Number.isFinite(c.contract_value) && c.credit_date <= asOf)
      .map((c) => ({
        contract_number: c.contract_number,
        project_code: c.project_code,
        project_name: c.project_name,
        credit_date: c.credit_date,
        contract_value: c.contract_value,
        payment_percentage: Math.min(100, Math.max(0, Number.isFinite(c.payment_percentage) ? c.payment_percentage : 0)),
      }));
    if (contracts.length > 0) customers.push({ ref: client.id, contracts });
  }
  return { as_of: asOf, customers };
}

/**
 * Stable key for the analysed data. Ignores `as_of` and ordering, so the
 * analysis reruns only when contract data actually changes.
 */
export function fingerprintRequest(request: ProspectAnalysisRequest): string {
  const lines = request.customers
    .flatMap((customer) =>
      customer.contracts.map(
        (c) =>
          `${customer.ref}|${c.contract_number}|${c.project_code}|${c.credit_date}|${c.contract_value}|${c.payment_percentage}`
      )
    )
    .sort();
  // FNV-1a, 32-bit: fast and good enough to tell data versions apart.
  let hash = 0x811c9dc5;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      hash ^= line.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x0a;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${lines.length}-${hash.toString(16)}`;
}

/** Checks a decoded response has the shape the UI relies on. */
export function isProspectAnalysisResponse(value: unknown): value is ProspectAnalysisResponse {
  if (!isObject(value)) return false;
  const { status, model, drivers, prospects, summary } = value;
  return (
    (status === "ok" || status === "insufficient_data" || status === "weak_signal") &&
    isObject(model) &&
    isObject(model.trained_on) &&
    typeof model.trained_on.repeat === "number" &&
    typeof model.trained_on.single === "number" &&
    (model.cv_auc === null || typeof model.cv_auc === "number") &&
    (model.base_rate === null || typeof model.base_rate === "number") &&
    Array.isArray(drivers) &&
    drivers.every(
      (d) => isObject(d) && typeof d.statement === "string" && typeof d.odds_ratio === "number" && (d.direction === "up" || d.direction === "down")
    ) &&
    Array.isArray(prospects) &&
    prospects.every(
      (p) =>
        isObject(p) &&
        typeof p.ref === "string" &&
        typeof p.probability === "number" &&
        typeof p.lift === "number" &&
        (p.tier === "high" || p.tier === "promising") &&
        Array.isArray(p.reasons)
    ) &&
    isObject(summary) &&
    typeof summary.high === "number" &&
    typeof summary.promising === "number"
  );
}

/** Plain-language reason shown when the dashboard falls back to the rule-based profile. */
export function fallbackReason(response: ProspectAnalysisResponse): string {
  const { repeat, single } = response.model.trained_on;
  if (response.status === "insufficient_data") {
    return `Needs at least 30 repeat and 30 single-contract customers with 6+ months of history (have ${repeat} / ${single}).`;
  }
  if (response.status === "weak_signal") {
    return `Purchase data doesn't yet predict repeat buying reliably (accuracy AUC ${response.model.cv_auc?.toFixed(2)}, needs 0.60).`;
  }
  return "";
}

export async function fetchProspectAnalysis(
  request: ProspectAnalysisRequest,
  signal?: AbortSignal
): Promise<ProspectAnalysisResponse> {
  const response = await fetch(PROSPECT_ANALYSIS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: withTimeout(signal, PROSPECT_ANALYSIS_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Prospect analysis returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const body: unknown = await response.json();
  if (!isProspectAnalysisResponse(body)) throw new Error("Prospect analysis returned an unexpected response");
  return body;
}

/** Aborts when the caller aborts or after `ms`, whichever comes first. */
function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function isObject(value: unknown): value is Record<string, unknown> & { [k: string]: any } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
