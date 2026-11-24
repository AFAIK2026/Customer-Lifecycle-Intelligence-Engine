import { describe, expect, it } from "vitest";
import type { AppData, Client, PafRow } from "@/types";
import { buildDocStatus } from "@/lib/milestones";
import { applyPafImport, createProfileLookup, normalizeContractNumber, removePafImport } from "@/lib/pafImports";

function client(id: string, name: string, contracts: string[]): Client {
  return {
    id,
    name,
    contract_value: 1,
    payment_to_date: 0,
    payment_percentage: 0,
    documentation_status: buildDocStatus([]),
    milestones_reached: [],
    created_at: "2026-01-01T00:00:00.000Z",
    contracts: contracts.map((n) => ({
      contract_number: n,
      project_code: "P",
      project_name: "P",
      credit_date: "2025-01-01T00:00:00.000Z",
      contract_value: 1,
      payment_percentage: 0,
      payment_to_date: 0,
    })),
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
    customer_aliases: Object.fromEntries(clients.map((c, i) => [c.name.toLowerCase(), i + 1])),
    client_profiles: {},
    paf_imports: [],
  };
}

function row(name: string, contract: string, overrides: { mobile?: string; birthdate?: string; occupation?: string } = {}): PafRow {
  return {
    customer_number: "",
    contract_number: contract,
    customer_name: name,
    personal: { family_name: "", first_name: "", middle_name: "", sex: "", birthdate: overrides.birthdate ?? "", citizenship: "", civil_status: "", id_type: "" },
    contact: { home_address: "", mailing_address: "", mobile: overrides.mobile ?? "", home_phone: "", office_phone: "", email: "" },
    buyer: { buyer_role: "", buyer_type: "", authorized_representative: "" },
    employment: {
      occupation: overrides.occupation ?? "",
      employment_type: "",
      employment_status: "",
      employer: "",
      position: "",
      years_in_work: null,
      business_address: "",
      gross_monthly_income: null,
    },
    corporate: null,
    spouse: null,
  };
}

const T1 = "2026-11-01T00:00:00.000Z";
const T2 = "2026-11-02T00:00:00.000Z";

describe("normalizeContractNumber", () => {
  it("ignores spaces and dashes", () => {
    expect(normalizeContractNumber("0000-0040 6709-52978")).toBe(normalizeContractNumber("00000040670952978"));
  });
});

describe("applyPafImport", () => {
  it("matches by contract number first, then by name, and keeps unmatched rows", () => {
    const juan = client("c1", "DELA CRUZ, JUAN", ["0000-0001-1111"]);
    const maria = client("c2", "SANTOS, MARIA", ["0000-0002-2222"]);
    const result = applyPafImport(data([juan, maria]), {
      fileName: "paf.xlsx",
      importedAt: T1,
      rows: [
        row("D. CRUZ, JUAN (misspelt)", "000000011111", { mobile: "0917" }),
        row("santos, maria", "", { mobile: "0918" }),
        row("NEW, BUYER", "0000-0009-9999", { mobile: "0919" }),
      ],
    });

    expect(result.matches.map((m) => m.clientId)).toEqual(["c1", "c2", null]);
    expect(result.record).toMatchObject({ file_name: "paf.xlsx", row_count: 3, matched: 2, unmatched: 1 });
    // Matched profiles are keyed by the client's own name.
    expect(result.data.client_profiles["dela cruz, juan"].contact.mobile).toBe("0917");
    expect(result.data.client_profiles["santos, maria"].contact.mobile).toBe("0918");
    expect(result.data.client_profiles["new, buyer"].customer_name).toBe("NEW, BUYER");
    // PAF-only customers get a permanent alias number.
    expect(result.data.customer_aliases["new, buyer"]).toBe(3);
  });

  it("merges several imports: later non-empty values win, blanks never erase", () => {
    const juan = client("c1", "DELA CRUZ, JUAN", ["K1"]);
    const first = applyPafImport(data([juan]), { fileName: "a.xlsx", importedAt: T1, rows: [row("DELA CRUZ, JUAN", "K1", { mobile: "0917", occupation: "Engineer" })] });
    const second = applyPafImport(first.data, { fileName: "b.xlsx", importedAt: T2, rows: [row("DELA CRUZ, JUAN", "K2", { mobile: "0999" })] });
    const profile = second.data.client_profiles["dela cruz, juan"];

    expect(profile.contact.mobile).toBe("0999");
    expect(profile.employment.occupation).toBe("Engineer");
    expect(profile.contract_numbers).toEqual(["K1", "K2"]);
    expect(profile.source_import_id).toBe(second.record.id);
    expect(second.data.paf_imports.map((r) => r.file_name)).toEqual(["a.xlsx", "b.xlsx"]);
  });
});

describe("compact storage", () => {
  it("saves rows without empty fields and replays them to identical profiles", () => {
    const juan = client("c1", "DELA CRUZ, JUAN", ["K1"]);
    const first = applyPafImport(data([juan]), { fileName: "a.xlsx", importedAt: T1, rows: [row("DELA CRUZ, JUAN", "K1", { mobile: "0917" })] });
    const second = applyPafImport(first.data, { fileName: "b.xlsx", importedAt: T2, rows: [row("OTHER, PERSON", "K9", { occupation: "Nurse" })] });

    const saved = first.record.rows[0];
    expect(saved).toEqual({ contract_number: "K1", customer_name: "DELA CRUZ, JUAN", personal: {}, contact: { mobile: "0917" }, buyer: {}, employment: {} });

    // Removing the second import replays the first from its compact rows.
    const replayed = removePafImport(second.data, second.record.id);
    expect(replayed.client_profiles).toEqual(first.data.client_profiles);
  });
});

describe("removePafImport", () => {
  it("rebuilds profiles from the remaining imports", () => {
    const juan = client("c1", "DELA CRUZ, JUAN", ["K1"]);
    const first = applyPafImport(data([juan]), { fileName: "a.xlsx", importedAt: T1, rows: [row("DELA CRUZ, JUAN", "K1", { mobile: "0917" })] });
    const second = applyPafImport(first.data, {
      fileName: "b.xlsx",
      importedAt: T2,
      rows: [row("DELA CRUZ, JUAN", "K1", { mobile: "0999" }), row("ONLY, IN B", "K7")],
    });

    const removed = removePafImport(second.data, second.record.id);
    expect(removed.paf_imports).toHaveLength(1);
    expect(removed.client_profiles["dela cruz, juan"].contact.mobile).toBe("0917");
    expect(removed.client_profiles["only, in b"]).toBeUndefined();

    const empty = removePafImport(removed, first.record.id);
    expect(empty.client_profiles).toEqual({});
  });

  it("ignores unknown import ids", () => {
    const d = data([]);
    expect(removePafImport(d, "nope")).toBe(d);
  });
});

describe("createProfileLookup", () => {
  it("finds a profile by name, or by a shared contract number", () => {
    const before = applyPafImport(data([]), {
      fileName: "a.xlsx",
      importedAt: T1,
      rows: [row("PAF SPELLING, JUAN", "0000-0001-1111", { birthdate: "1990-06-19" }), row("SANTOS, MARIA", "")],
    }).data;
    // The Sales Report arrives later with a different spelling of Juan's name.
    const later = { ...before, clients: [client("c1", "DELA CRUZ, JUAN", ["000000011111"]), client("c2", "Santos, Maria", [])] };
    const lookup = createProfileLookup(later);

    expect(lookup(later.clients[0])?.personal.birthdate).toBe("1990-06-19");
    expect(lookup(later.clients[1])?.customer_name).toBe("SANTOS, MARIA");
    expect(lookup(client("c3", "NOBODY", ["X"]))).toBeUndefined();
  });
});
