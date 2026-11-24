import { describe, expect, it } from "vitest";
import type { Client, Contract } from "@/types";
import { buildDocStatus } from "@/lib/milestones";
import {
  buildProspectRequest,
  fallbackReason,
  fingerprintRequest,
  isProspectAnalysisResponse,
  type ProspectAnalysisResponse,
} from "@/lib/prospectAnalysis";

const NOW = new Date("2026-11-24T08:00:00.000Z");

function contract(n: string, overrides: Partial<Contract> = {}): Contract {
  return {
    contract_number: n,
    project_code: "TWR",
    project_name: "Aspire Tower",
    credit_date: "2024-03-01T00:00:00.000Z",
    contract_value: 5e6,
    payment_percentage: 12,
    payment_to_date: 6e5,
    ...overrides,
  };
}

function client(id: string, name: string, contracts: Contract[]): Client {
  return {
    id,
    name,
    contract_value: 0,
    payment_to_date: 0,
    payment_percentage: 0,
    documentation_status: buildDocStatus(["Valid ID"]),
    milestones_reached: [],
    created_at: NOW.toISOString(),
    contracts,
    projected_10_alert_sent: false,
  };
}

const okResponse: ProspectAnalysisResponse = {
  status: "ok",
  model: {
    version: "prospect-logit-1",
    method: "L2 logistic regression (NumPy IRLS)",
    trained_on: { repeat: 157, single: 783 },
    excluded_recent: 0,
    base_rate: 0.167,
    cv_auc: 0.74,
    cv_folds: 5,
    reference_project: "Aspire Tower",
  },
  drivers: [
    { feature: "project_RES", label: "First purchase in Bayview", odds_ratio: 2.1, ci_low: 1.4, ci_high: 3.2, direction: "up", statement: "…" },
  ],
  prospects: [{ ref: "a", probability: 0.38, lift: 2.3, tier: "high", reasons: ["Bayview Residences"] }],
  summary: { scored: 783, high: 42, promising: 87 },
};

describe("buildProspectRequest", () => {
  it("sends only ids and contract figures — never names or documents", () => {
    const request = buildProspectRequest([client("id-1", "DELA CRUZ, JUAN", [contract("C1")])], NOW);
    const json = JSON.stringify(request);
    expect(json).not.toContain("DELA CRUZ");
    expect(json).not.toContain("Valid ID");
    expect(request).toEqual({
      as_of: NOW.toISOString(),
      customers: [
        {
          ref: "id-1",
          contracts: [
            {
              contract_number: "C1",
              project_code: "TWR",
              project_name: "Aspire Tower",
              credit_date: "2024-03-01T00:00:00.000Z",
              contract_value: 5e6,
              payment_percentage: 12,
            },
          ],
        },
      ],
    });
  });

  it("leaves out contracts the API would reject and clips payment", () => {
    const request = buildProspectRequest(
      [
        client("a", "A", [
          contract("zero", { contract_value: 0 }),
          contract("future", { credit_date: "2027-01-01T00:00:00.000Z" }),
          contract("over", { payment_percentage: 130 }),
        ]),
        client("b", "B", [contract("only-bad", { contract_value: -1 })]),
      ],
      NOW
    );
    expect(request.customers).toHaveLength(1);
    expect(request.customers[0].contracts.map((c) => [c.contract_number, c.payment_percentage])).toEqual([["over", 100]]);
  });
});

describe("fingerprintRequest", () => {
  const clients = [client("a", "A", [contract("C1")]), client("b", "B", [contract("C2"), contract("C3")])];

  it("ignores as_of and ordering", () => {
    const first = buildProspectRequest(clients, NOW);
    const later = buildProspectRequest([...clients].reverse(), new Date("2026-11-25T00:00:00Z"));
    expect(fingerprintRequest(first)).toBe(fingerprintRequest(later));
  });

  it("changes when a payment changes", () => {
    const changed = [clients[0], client("b", "B", [contract("C2", { payment_percentage: 13 }), contract("C3")])];
    expect(fingerprintRequest(buildProspectRequest(changed, NOW))).not.toBe(fingerprintRequest(buildProspectRequest(clients, NOW)));
  });
});

describe("isProspectAnalysisResponse", () => {
  it("accepts a valid response and empty fallback responses", () => {
    expect(isProspectAnalysisResponse(okResponse)).toBe(true);
    expect(
      isProspectAnalysisResponse({ ...okResponse, status: "weak_signal", drivers: [], prospects: [], model: { ...okResponse.model, cv_auc: 0.55 } })
    ).toBe(true);
  });

  it("rejects malformed responses", () => {
    expect(isProspectAnalysisResponse(null)).toBe(false);
    expect(isProspectAnalysisResponse({ ...okResponse, status: "maybe" })).toBe(false);
    expect(isProspectAnalysisResponse({ ...okResponse, prospects: [{ ref: "a" }] })).toBe(false);
    expect(isProspectAnalysisResponse({ ...okResponse, drivers: "none" })).toBe(false);
    expect(isProspectAnalysisResponse({ ...okResponse, model: { ...okResponse.model, trained_on: null } })).toBe(false);
  });
});

describe("fallbackReason", () => {
  it("explains insufficient data and weak signal", () => {
    expect(fallbackReason({ ...okResponse, status: "insufficient_data", model: { ...okResponse.model, trained_on: { repeat: 93, single: 9 } } })).toBe(
      "Needs at least 30 repeat and 30 single-contract customers with 6+ months of history (have 93 / 9)."
    );
    expect(fallbackReason({ ...okResponse, status: "weak_signal", model: { ...okResponse.model, cv_auc: 0.552 } })).toBe(
      "Purchase data doesn't yet predict repeat buying reliably (accuracy AUC 0.55, needs 0.60)."
    );
  });
});
