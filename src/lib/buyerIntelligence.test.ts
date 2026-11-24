import { describe, expect, it } from "vitest";
import type { AppData, Client, Contract } from "@/types";
import { buildDocStatus } from "@/lib/milestones";
import {
  buildActionContext,
  buildProspectProfile,
  buildRepeatBuyerPersona,
  computeCustomerActions,
  daysUntilAnniversary,
  daysUntilBirthday,
  flagsForClient,
  lifecycleStage,
  summarizeCustomerBase,
  type ForecastGroups,
} from "@/lib/buyerIntelligence";

const NOW = new Date("2026-11-24T08:00:00.000Z");

function contract(n: string, value: number, project = "Tower One", credit = "2024-03-01T00:00:00.000Z"): Contract {
  return {
    contract_number: n,
    project_code: project.slice(0, 3).toUpperCase(),
    project_name: project,
    credit_date: credit,
    contract_value: value,
    payment_percentage: 0,
    payment_to_date: 0,
  };
}

function client(id: string, contracts: Contract[], pct: number, milestones: string[] = []): Client {
  const contract_value = contracts.reduce((s, c) => s + c.contract_value, 0);
  return {
    id,
    name: `Name ${id}`,
    contract_value,
    payment_to_date: (pct / 100) * contract_value,
    payment_percentage: pct,
    documentation_status: buildDocStatus([]),
    milestones_reached: milestones,
    created_at: NOW.toISOString(),
    contracts,
    projected_10_alert_sent: false,
  };
}

function data(clients: Client[]): AppData {
  return {
    clients,
    payment_history: [],
    contract_payment_history: [],
    notifications: [],
    settings: { alert_email: "a@example.com", hide_customer_names: true },
    imports: [],
    baseline: null,
    customer_aliases: {},
    client_profiles: {},
    paf_imports: [],
  };
}

const noForecast: ForecastGroups = { approaching10: [], projected10Next30: [], nearCreq: [], inactive: [] };

describe("summarizeCustomerBase", () => {
  it("counts repeat buyers and averages their total selling price", () => {
    const clients = [
      client("a", [contract("1", 10_000_000), contract("2", 10_000_000)], 12),
      client("b", [contract("3", 5_000_000), contract("4", 5_000_000), contract("5", 10_000_000)], 12),
      client("c", [contract("6", 3_000_000)], 5),
      client("d", [contract("7", 3_000_000)], 5),
    ];
    expect(summarizeCustomerBase(clients)).toEqual({
      totalCustomers: 4,
      repeatBuyers: 2,
      repeatBuyerShare: 50,
      avgRepeatBuyerTsp: 20_000_000,
    });
  });

  it("returns zeros for an empty customer base", () => {
    expect(summarizeCustomerBase([])).toEqual({ totalCustomers: 0, repeatBuyers: 0, repeatBuyerShare: 0, avgRepeatBuyerTsp: 0 });
  });
});

describe("lifecycleStage", () => {
  it("ranks CREQ above the 10% milestone", () => {
    expect(lifecycleStage(client("a", [], 15, ["10% Payment", "CREQ"]))).toBe("CREQ Complete");
    expect(lifecycleStage(client("a", [], 15, ["10% Payment"]))).toBe("Milestone-Reached");
    expect(lifecycleStage(client("a", [], 4))).toBe("Early Payment");
  });
});

describe("buildRepeatBuyerPersona", () => {
  it("returns null without repeat buyers", () => {
    expect(buildRepeatBuyerPersona([client("a", [contract("1", 1)], 5)], new Set())).toBeNull();
  });

  it("summarizes the typical repeat buyer", () => {
    const clients = [
      client("a", [contract("1", 8e6, "Tower One"), contract("2", 8e6, "Tower One")], 12, ["10% Payment"]),
      client("b", [contract("3", 8e6, "Tower One"), contract("4", 8e6, "Lot Park")], 15, ["10% Payment"]),
      client("c", [contract("5", 2e6)], 3),
      client("d", [contract("6", 2e6)], 3),
    ];
    expect(buildRepeatBuyerPersona(clients, new Set())).toEqual({
      buyerType: "Repeat Buyer",
      commonProject: "Tower One",
      typicalOwnership: 2,
      customerValue: "High",
      engagementTrend: "Active",
      lifecycleStage: "Milestone-Reached",
      sampleSize: 2,
    });
  });

  it("reports a slowing trend when most repeat buyers are inactive", () => {
    const clients = [
      client("a", [contract("1", 1e6), contract("2", 1e6)], 12),
      client("b", [contract("3", 1e6), contract("4", 1e6)], 12),
    ];
    expect(buildRepeatBuyerPersona(clients, new Set(["a", "b"]))?.engagementTrend).toBe("Slowing");
  });
});

describe("buildProspectProfile", () => {
  it("selects single-contract customers meeting at least three criteria", () => {
    const clients = [
      client("r1", [contract("1", 6e6, "Tower One"), contract("2", 6e6, "Tower One")], 20),
      // premium + payment + responsive + project match → prospect
      client("p1", [contract("3", 7e6, "Tower One")], 12),
      // premium + responsive + project match → prospect
      client("p2", [contract("4", 6e6, "Tower One")], 4),
      // responsive only → not a prospect
      client("n1", [contract("5", 1e6, "Elsewhere")], 4),
      // premium + payment, but inactive and other project → not a prospect
      client("n2", [contract("6", 9e6, "Elsewhere")], 15),
    ];
    const profile = buildProspectProfile(clients, new Set(["n2"]));

    expect(profile.prospects.map((c) => c.id)).toEqual(["p1", "p2"]);
    expect(profile.premiumThreshold).toBe(6e6);
    expect(profile.repeatBuyerProjects).toEqual(["Tower One"]);
    expect(Object.fromEntries(profile.criteria.map((c) => [c.id, c.matches]))).toEqual({
      premium: 3,
      payment_capacity: 2,
      responsive: 3,
      profile_match: 2,
    });
  });

  it("finds no prospects without repeat buyers to compare against", () => {
    expect(buildProspectProfile([client("a", [contract("1", 9e6)], 50)], new Set()).prospects).toEqual([]);
  });
});

describe("daysUntilAnniversary", () => {
  it("counts days to the next anniversary", () => {
    expect(daysUntilAnniversary("2024-11-28T00:00:00.000Z", NOW)).toBe(4);
    expect(daysUntilAnniversary("2024-11-24T00:00:00.000Z", NOW)).toBe(0);
  });

  it("rolls over to next year once this year's date has passed", () => {
    expect(daysUntilAnniversary("2024-11-20T00:00:00.000Z", NOW)).toBe(361);
  });

  it("ignores purchases less than a year old", () => {
    expect(daysUntilAnniversary("2026-11-26T00:00:00.000Z", NOW)).toBeNull();
    expect(daysUntilAnniversary("2025-12-01T00:00:00.000Z", NOW)).toBe(7);
  });

  it("celebrates Feb 29 purchases on Feb 28 in non-leap years", () => {
    expect(daysUntilAnniversary("2024-02-29T00:00:00.000Z", new Date("2027-02-26T00:00:00.000Z"))).toBe(2);
  });
});

describe("computeCustomerActions", () => {
  it("raises flags and orders customers by priority then contract value", () => {
    const repeat = client("repeat", [contract("1", 5e6), contract("2", 5e6)], 15, ["10% Payment"]);
    const approaching = client("approaching", [contract("3", 4e6)], 9.2);
    const anniversary = client("anniv", [contract("4", 3e6, "Tower One", "2023-11-27T00:00:00.000Z")], 3);
    const inactive = client("inactive", [contract("5", 9e6)], 4);
    const quiet = client("quiet", [contract("6", 1e6)], 4);

    const actions = computeCustomerActions(
      data([quiet, inactive, anniversary, approaching, repeat]),
      { ...noForecast, approaching10: [approaching], inactive: [inactive] },
      NOW
    );

    expect(actions.map((a) => [a.client.id, a.primary.flag, a.primary.priority])).toEqual([
      ["repeat", "repeat_purchase", "high"],
      ["approaching", "payment_milestone", "medium"],
      ["anniv", "relationship_touchpoint", "medium"],
      ["inactive", "inactive_engagement", "low"],
    ]);
    expect(actions[0].primary.keyIndicator).toBe("Existing repeat buyer (2 properties)");
    expect(actions[1].primary.keyIndicator).toBe("Approaching 10% payment (9.2%)");
    expect(actions[2].primary.keyIndicator).toBe("Purchase anniversary within 3 days");
  });

  it("does not offer a repeat purchase to an inactive repeat buyer", () => {
    const repeat = client("r", [contract("1", 5e6), contract("2", 5e6)], 15);
    const [action] = computeCustomerActions(data([repeat]), { ...noForecast, inactive: [repeat] }, NOW);
    expect(action.flags.map((f) => f.flag)).toEqual(["inactive_engagement"]);
  });

  it("keeps every flag, highest priority first", () => {
    const c = client("c", [contract("1", 5e6, "T", "2020-11-25T00:00:00.000Z")], 9);
    const [action] = computeCustomerActions(data([c]), { ...noForecast, projected10Next30: [c], inactive: [c] }, NOW);
    expect(action.flags.map((f) => f.flag)).toEqual(["payment_milestone", "relationship_touchpoint", "inactive_engagement"]);
    expect(action.primary.keyIndicator).toBe("On pace for 10% within 30 days");
  });
});

describe("birthday touchpoints", () => {
  it("counts days to the next birthday, rolling over the year", () => {
    expect(daysUntilBirthday("1960-11-27", NOW)).toBe(3);
    expect(daysUntilBirthday("1960-11-24", NOW)).toBe(0);
    expect(daysUntilBirthday("1960-11-20", NOW)).toBe(361);
    expect(daysUntilBirthday(undefined, NOW)).toBeNull();
    expect(daysUntilBirthday("", NOW)).toBeNull();
  });

  it("flags a PAF birthday within 7 days ahead of a later anniversary", () => {
    const c = client("b", [contract("1", 1e6, "T", "2023-11-30T00:00:00.000Z")], 3);
    const [action] = computeCustomerActions(data([c]), noForecast, NOW, () => "1985-11-26");
    expect(action.primary).toMatchObject({
      flag: "relationship_touchpoint",
      keyIndicator: "Birthday within 2 days",
      recommendedAction: "Automated personalized greeting",
    });
  });

  it("falls back to the anniversary when it is sooner or there is no birthdate", () => {
    const c = client("b", [contract("1", 1e6, "T", "2023-11-25T00:00:00.000Z")], 3);
    expect(computeCustomerActions(data([c]), noForecast, NOW, () => "1985-11-29")[0].primary.keyIndicator).toBe(
      "Purchase anniversary within 1 day"
    );
    expect(computeCustomerActions(data([c]), noForecast, NOW)[0].primary.keyIndicator).toBe(
      "Purchase anniversary within 1 day"
    );
  });

  it("flagsForClient matches computeCustomerActions", () => {
    const c = client("x", [contract("1", 1e6)], 9.5);
    const ctx = buildActionContext({ ...noForecast, approaching10: [c] }, () => "1990-11-24", NOW);
    expect(flagsForClient(c, ctx).map((f) => f.flag)).toEqual(["payment_milestone", "relationship_touchpoint"]);
  });
});
