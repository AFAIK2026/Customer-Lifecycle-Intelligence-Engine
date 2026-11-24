import { describe, expect, it } from "vitest";
import { PafFormatError, headerKey, parsePafWorkbook, toIsoDate, toNumber, type CellValue, type WorkbookSheet } from "@/lib/paf";

// Headers exactly as in the supplied PAF template (abridged where noted).
const CUSTOMER_HEADER = [
  "Customer Number (Sales Report)",
  "Contract Number (Sales Report)",
  "Customer Name (Sales Report)",
  "Family Name",
  "First Name",
  "Middle Name",
  "Age",
  "Sex",
  "Birthdate (MM/DD/YYYY)",
  "Citizenship",
  "Civil Status",
  "Home Address (No./Street/City/Municipality/Province/Zip Code)",
  "TIN (Synthetic)",
  "Government Issued No. (Synthetic)",
  "Specify Type of ID",
  "Mailing Address",
  "Home Telephone No.",
  "Office Telephone No.",
  "Mobile No. (Synthetic)",
  "E-mail Address",
  "Buyer Role",
  "Authorized Representative",
  "Occupation",
  "Employment Type (Local/OFW)",
  "Employment Status (Regular/Probationary/Casual/Contractual)",
  "Present Employer / Business Name",
  "Position",
  "Years in Current Work / Business",
  "Employment / Business Address",
  "Gross Monthly Income (PHP)",
  "Buyer Type (Personal / Corporate)",
  "Corporate Legal Form (if applicable)",
  "Company Name (if applicable)",
];

function customerRow(overrides: Partial<Record<string, CellValue>> = {}): CellValue[] {
  const values: Record<string, CellValue> = {
    "Customer Number (Sales Report)": "50001216752",
    "Contract Number (Sales Report)": "0000-0040-6709-52978",
    "Customer Name (Sales Report)": "NAVARRO, ERIKA CASTILLO",
    "Family Name": "Navarro",
    "First Name": "Erika",
    "Middle Name": "Castillo",
    Age: 66,
    Sex: "Female",
    "Birthdate (MM/DD/YYYY)": "06/19/1960",
    Citizenship: "Filipino",
    "Civil Status": "Married",
    "Home Address (No./Street/City/Municipality/Province/Zip Code)": "684 Mahogany Street, Las Piñas",
    "TIN (Synthetic)": "SYN-TIN-000001",
    "Government Issued No. (Synthetic)": "SYN-ID-000001",
    "Specify Type of ID": "Synthetic Test ID",
    "Mobile No. (Synthetic)": "09XX-XXX-0001",
    "E-mail Address": "erika.navarro001@example.com",
    "Buyer Role": "Co-owner",
    Occupation: "Self-employed",
    "Present Employer / Business Name": "Summit Peak Consulting",
    Position: "Operations Manager",
    "Years in Current Work / Business": 4.2,
    "Gross Monthly Income (PHP)": 122500,
    "Buyer Type (Personal / Corporate)": "Personal",
    ...overrides,
  };
  return CUSTOMER_HEADER.map((h) => values[h] ?? null);
}

const SPOUSE_HEADER = [
  "Customer Number (Sales Report)",
  "Customer Name (Sales Report)",
  "Spouse Family Name",
  "Spouse First Name",
  "Spouse Middle Name",
  "Spouse Age",
  "Spouse Sex",
  "Spouse Birthdate (MM/DD/YYYY)",
  "Spouse TIN (Synthetic)",
  "Spouse Government Issued No. (Synthetic)",
  "Spouse Occupation",
  "Spouse Gross Monthly Income (PHP)",
];

function workbook(customerRows: CellValue[][], extra: WorkbookSheet[] = []): WorkbookSheet[] {
  return [{ name: "Customer Details", rows: [CUSTOMER_HEADER, ...customerRows] }, ...extra];
}

describe("headerKey", () => {
  it("ignores case, spacing and bracketed text", () => {
    expect(headerKey("Mobile No. (Synthetic)")).toBe("mobile no.");
    expect(headerKey("  Birthdate   (MM/DD/YYYY) ")).toBe("birthdate");
    expect(headerKey("Customer Number (Sales Report)")).toBe("customer number");
  });
});

describe("parsePafWorkbook", () => {
  it("reads a template row into a PafRow", () => {
    const { rows, skipped, warnings } = parsePafWorkbook(workbook([customerRow()]));
    expect(skipped).toEqual([]);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer_number: "50001216752",
      contract_number: "0000-0040-6709-52978",
      customer_name: "NAVARRO, ERIKA CASTILLO",
      personal: { family_name: "Navarro", first_name: "Erika", birthdate: "1960-06-19", id_type: "Synthetic Test ID" },
      contact: { mobile: "09XX-XXX-0001", email: "erika.navarro001@example.com" },
      buyer: { buyer_role: "Co-owner", buyer_type: "Personal" },
      employment: { employer: "Summit Peak Consulting", years_in_work: 4.2, gross_monthly_income: 122500 },
      corporate: null,
      spouse: null,
    });
  });

  it("never keeps TIN or government ID numbers", () => {
    const spouse: WorkbookSheet = {
      name: "Spouse Details",
      rows: [SPOUSE_HEADER, ["50001216752", "NAVARRO, ERIKA CASTILLO", "Dela Cruz", "Franco", "Louise", 66, "Male", "06/28/1960", "SYN-TIN-SP-000001", "SYN-ID-SP-000001", "Employed", 170000]],
    };
    const result = JSON.stringify(parsePafWorkbook(workbook([customerRow()], [spouse])));
    expect(result).not.toContain("SYN-TIN");
    expect(result).not.toContain("SYN-ID");
  });

  it("links spouse rows by customer number", () => {
    const spouse: WorkbookSheet = {
      name: "Spouse Details",
      rows: [
        SPOUSE_HEADER,
        ["50001216752", "NAVARRO, ERIKA CASTILLO", "Dela Cruz", "Franco", "Louise", 66, "Male", "06/28/1960", null, null, "Employed", 170000],
        ["99999", "NOBODY, HERE", "X", "Y", "Z", 30, "Male", "01/01/1996", null, null, "", null],
      ],
    };
    const { rows, spouseLinked, unlinked } = parsePafWorkbook(workbook([customerRow()], [spouse]));
    expect(spouseLinked).toBe(1);
    expect(rows[0].spouse).toMatchObject({ family_name: "Dela Cruz", birthdate: "1960-06-28", gross_monthly_income: 170000 });
    expect(unlinked).toEqual([{ sheet: "Spouse Details", row: 3, reason: "Customer not found on Customer Details" }]);
  });

  it("merges corporate details from both sheets", () => {
    const corporate: WorkbookSheet = {
      name: "Corporate Buyer Template",
      rows: [
        ["Customer Number (Sales Report)", "Customer Name (Sales Report)", "Corporate Buyer Type (Sole Proprietorship / Partnership / Corporation)", "Company Name", "TIN (Synthetic)", "Representative Position"],
        ["50001216752", "", "Corporation", "Acme Holdings Inc.", "SYN-TIN-CORP", "President"],
      ],
    };
    const row = customerRow({ "Corporate Legal Form (if applicable)": "Partnership", "Company Name (if applicable)": "Old Name" });
    const { rows, corporateLinked } = parsePafWorkbook(workbook([row], [corporate]));
    expect(corporateLinked).toBe(1);
    expect(rows[0].corporate).toMatchObject({ legal_form: "Corporation", company_name: "Acme Holdings Inc.", representative_position: "President" });
    expect(JSON.stringify(rows)).not.toContain("SYN-TIN-CORP");
  });

  it("skips rows without a contract number or name and ignores blank rows", () => {
    const blank = CUSTOMER_HEADER.map(() => null);
    const nameless = customerRow({ "Contract Number (Sales Report)": null, "Customer Name (Sales Report)": null });
    const { rows, skipped } = parsePafWorkbook(workbook([customerRow(), blank, nameless]));
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([{ sheet: "Customer Details", row: 4, reason: "No contract number or customer name" }]);
  });

  it("warns about unreadable birthdates but keeps the row", () => {
    const { rows, warnings } = parsePafWorkbook(workbook([customerRow({ "Birthdate (MM/DD/YYYY)": "13/45/1990" })]));
    expect(rows[0].personal.birthdate).toBe("");
    expect(warnings).toEqual([{ sheet: "Customer Details", row: 2, reason: "Birthdate could not be read" }]);
  });

  it("finds sheets case-insensitively and tolerates missing optional columns", () => {
    const minimal: WorkbookSheet = { name: "customer details", rows: [["Customer Name (Sales Report)"], ["SANTOS, MARIA"]] };
    const { rows } = parsePafWorkbook([minimal]);
    expect(rows[0].customer_name).toBe("SANTOS, MARIA");
    expect(rows[0].contact.email).toBe("");
    expect(rows[0].employment.gross_monthly_income).toBeNull();
  });

  it("rejects workbooks without the Customer Details sheet or key columns", () => {
    expect(() => parsePafWorkbook([{ name: "Sheet1", rows: [["a"]] }])).toThrow(PafFormatError);
    expect(() => parsePafWorkbook([{ name: "Customer Details", rows: [["Family Name"], ["X"]] }])).toThrow(
      /Contract Number \(Sales Report\)/
    );
  });

  it("reads numeric customer numbers as text", () => {
    const { rows } = parsePafWorkbook(workbook([customerRow({ "Customer Number (Sales Report)": 50001216752 })]));
    expect(rows[0].customer_number).toBe("50001216752");
  });
});

describe("cell conversion", () => {
  it("parses birthdates from Excel dates and text", () => {
    expect(toIsoDate(new Date(Date.UTC(1990, 0, 31)))).toEqual({ value: "1990-01-31", invalid: false });
    expect(toIsoDate("1/5/1990")).toEqual({ value: "1990-01-05", invalid: false });
    expect(toIsoDate("1990-01-05")).toEqual({ value: "1990-01-05", invalid: false });
    expect(toIsoDate("02/30/1990")).toEqual({ value: "", invalid: true });
    expect(toIsoDate(null)).toEqual({ value: "", invalid: false });
  });

  it("parses numbers with peso signs and commas", () => {
    expect(toNumber("₱122,500")).toBe(122500);
    expect(toNumber(4.2)).toBe(4.2);
    expect(toNumber("n/a")).toBeNull();
    expect(toNumber("")).toBeNull();
  });
});
