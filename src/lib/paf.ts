/**
 * Parses a Purchase Application Form (PAF) workbook into PafRows.
 *
 * Input is the workbook already read into plain cell grids (see lib/pafExcel),
 * so this module stays pure and testable. Columns are matched by header name,
 * ignoring case, extra spaces and anything in parentheses, so
 * "Mobile No. (Synthetic)" and "Mobile No." are the same column.
 *
 * Government ID numbers and TINs are never read: those columns are not in the
 * column maps below, so their values cannot reach storage.
 */
import type { PafContact, PafCorporate, PafPersonal, PafRow, PafSpouse } from "@/types";

export type CellValue = string | number | boolean | Date | null | undefined;

export interface WorkbookSheet {
  name: string;
  rows: CellValue[][];
}

export interface PafRowIssue {
  sheet: string;
  /** 1-based spreadsheet row number. */
  row: number;
  reason: string;
}

export interface PafParseResult {
  rows: PafRow[];
  /** Rows that could not be imported at all. */
  skipped: PafRowIssue[];
  /** Rows imported with a field left empty (e.g. an unreadable birthdate). */
  warnings: PafRowIssue[];
  spouseLinked: number;
  corporateLinked: number;
  /** Spouse / corporate rows whose customer is not on the Customer Details sheet. */
  unlinked: PafRowIssue[];
}

export class PafFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PafFormatError";
  }
}

export const PAF_SHEETS = {
  customer: "Customer Details",
  spouse: "Spouse Details",
  corporate: "Corporate Buyer Template",
} as const;

export const MAX_PAF_ROWS = 20_000;
const MAX_TEXT_LENGTH = 300;

/** Header → comparable key: lowercase, parentheses removed, single spaces. */
export function headerKey(header: unknown): string {
  return String(header ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Column maps: field → header key
// ---------------------------------------------------------------------------

const KEY_COLUMNS = {
  customer_number: "customer number",
  contract_number: "contract number",
  customer_name: "customer name",
};

const PERSONAL_COLUMNS: Record<keyof PafPersonal, string> = {
  family_name: "family name",
  first_name: "first name",
  middle_name: "middle name",
  sex: "sex",
  birthdate: "birthdate",
  citizenship: "citizenship",
  civil_status: "civil status",
  id_type: "specify type of id",
};

const CONTACT_COLUMNS: Record<keyof PafContact, string> = {
  home_address: "home address",
  mailing_address: "mailing address",
  mobile: "mobile no.",
  home_phone: "home telephone no.",
  office_phone: "office telephone no.",
  email: "e-mail address",
};

const BUYER_COLUMNS = {
  buyer_role: "buyer role",
  buyer_type: "buyer type",
  authorized_representative: "authorized representative",
};

const EMPLOYMENT_TEXT_COLUMNS = {
  occupation: "occupation",
  employment_type: "employment type",
  employment_status: "employment status",
  employer: "present employer / business name",
  position: "position",
  business_address: "employment / business address",
};
const EMPLOYMENT_NUMBER_COLUMNS = {
  years_in_work: "years in current work / business",
  gross_monthly_income: "gross monthly income",
};

/** Corporate fields as they appear on the Customer Details sheet. */
const CORPORATE_DETAIL_COLUMNS: Partial<Record<keyof PafCorporate, string>> = {
  legal_form: "corporate legal form",
  company_name: "company name",
  nature_of_business: "nature of business",
  office_address: "corporate office address",
  office_phone: "corporate office telephone no.",
  website: "website address",
};

/** Corporate fields on the Corporate Buyer Template sheet. */
const CORPORATE_SHEET_COLUMNS: Record<keyof PafCorporate, string> = {
  legal_form: "corporate buyer type",
  company_name: "company name",
  nature_of_business: "nature of business",
  office_address: "office address",
  office_phone: "office telephone no.",
  website: "website address",
  representative: "authorized representative",
  representative_position: "representative position",
};

const SPOUSE_TEXT_COLUMNS = {
  family_name: "spouse family name",
  first_name: "spouse first name",
  middle_name: "spouse middle name",
  sex: "spouse sex",
  citizenship: "spouse citizenship",
  occupation: "spouse occupation",
  employment_type: "spouse employment type",
  employment_status: "spouse employment status",
  employer: "spouse present employer / business name",
  position: "spouse position",
  mobile: "spouse mobile no.",
  email: "spouse e-mail address",
};
const SPOUSE_NUMBER_COLUMNS = {
  years_in_work: "spouse years in current work / business",
  gross_monthly_income: "spouse gross monthly income",
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parsePafWorkbook(sheets: WorkbookSheet[]): PafParseResult {
  const customerSheet = findSheet(sheets, PAF_SHEETS.customer);
  if (!customerSheet) {
    throw new PafFormatError(`Workbook has no "${PAF_SHEETS.customer}" sheet`);
  }

  const customer = readTable(customerSheet);
  if (!customer.has(KEY_COLUMNS.contract_number) && !customer.has(KEY_COLUMNS.customer_name)) {
    throw new PafFormatError(
      `"${PAF_SHEETS.customer}" needs a "Contract Number (Sales Report)" or "Customer Name (Sales Report)" column`
    );
  }

  const skipped: PafRowIssue[] = [];
  const warnings: PafRowIssue[] = [];
  const rows: PafRow[] = [];

  for (const record of customer.records) {
    const contract_number = record.text(KEY_COLUMNS.contract_number);
    const customer_name = record.text(KEY_COLUMNS.customer_name);
    if (!contract_number && !customer_name) {
      skipped.push({ sheet: customerSheet.name, row: record.rowNumber, reason: "No contract number or customer name" });
      continue;
    }

    const birthdate = record.date(PERSONAL_COLUMNS.birthdate);
    if (birthdate.invalid) {
      warnings.push({ sheet: customerSheet.name, row: record.rowNumber, reason: "Birthdate could not be read" });
    }

    const detailCorporate = mapText(record, CORPORATE_DETAIL_COLUMNS);
    rows.push({
      customer_number: record.text(KEY_COLUMNS.customer_number),
      contract_number,
      customer_name,
      personal: { ...mapText(record, PERSONAL_COLUMNS), birthdate: birthdate.value },
      contact: mapText(record, CONTACT_COLUMNS),
      buyer: mapText(record, BUYER_COLUMNS),
      employment: {
        ...mapText(record, EMPLOYMENT_TEXT_COLUMNS),
        ...mapNumbers(record, EMPLOYMENT_NUMBER_COLUMNS),
      },
      corporate: hasAnyValue(detailCorporate) ? { ...emptyCorporate(), ...detailCorporate } : null,
      spouse: null,
    });
  }

  const linker = new RowLinker(rows);
  const unlinked: PafRowIssue[] = [];

  let spouseLinked = 0;
  const spouseSheet = findSheet(sheets, PAF_SHEETS.spouse);
  if (spouseSheet) {
    for (const record of readTable(spouseSheet).records) {
      const targets = linker.find(record);
      if (targets.length === 0) {
        unlinked.push({ sheet: spouseSheet.name, row: record.rowNumber, reason: "Customer not found on Customer Details" });
        continue;
      }
      const birthdate = record.date("spouse birthdate");
      if (birthdate.invalid) {
        warnings.push({ sheet: spouseSheet.name, row: record.rowNumber, reason: "Spouse birthdate could not be read" });
      }
      const spouse: PafSpouse = {
        ...mapText(record, SPOUSE_TEXT_COLUMNS),
        ...mapNumbers(record, SPOUSE_NUMBER_COLUMNS),
        birthdate: birthdate.value,
      };
      for (const target of targets) target.spouse = spouse;
      spouseLinked++;
    }
  }

  let corporateLinked = 0;
  const corporateSheet = findSheet(sheets, PAF_SHEETS.corporate);
  if (corporateSheet) {
    for (const record of readTable(corporateSheet).records) {
      const corporate = mapText(record, CORPORATE_SHEET_COLUMNS);
      if (!hasAnyValue(corporate)) continue;
      const targets = linker.find(record);
      if (targets.length === 0) {
        unlinked.push({ sheet: corporateSheet.name, row: record.rowNumber, reason: "Customer not found on Customer Details" });
        continue;
      }
      for (const target of targets) {
        target.corporate = mergeNonEmpty(target.corporate ?? emptyCorporate(), corporate);
      }
      corporateLinked++;
    }
  }

  return { rows, skipped, warnings, spouseLinked, corporateLinked, unlinked };
}

function findSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | undefined {
  const wanted = headerKey(name);
  return sheets.find((s) => headerKey(s.name) === wanted);
}

/** Links spouse / corporate rows to customer rows by Customer Number, else by name. */
class RowLinker {
  private byNumber = new Map<string, PafRow[]>();
  private byName = new Map<string, PafRow[]>();

  constructor(rows: PafRow[]) {
    for (const row of rows) {
      if (row.customer_number) push(this.byNumber, row.customer_number, row);
      if (row.customer_name) push(this.byName, row.customer_name.toLowerCase(), row);
    }
  }

  find(record: TableRecord): PafRow[] {
    const number = record.text(KEY_COLUMNS.customer_number);
    if (number && this.byNumber.has(number)) return this.byNumber.get(number)!;
    const name = record.text(KEY_COLUMNS.customer_name).toLowerCase();
    return (name && this.byName.get(name)) || [];
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ---------------------------------------------------------------------------
// Table reading and cell conversion
// ---------------------------------------------------------------------------

interface TableRecord {
  rowNumber: number;
  text(key: string): string;
  number(key: string): number | null;
  date(key: string): { value: string; invalid: boolean };
}

interface Table {
  has(key: string): boolean;
  records: TableRecord[];
}

function readTable(sheet: WorkbookSheet): Table {
  const [header = [], ...body] = sheet.rows;
  if (body.length > MAX_PAF_ROWS) {
    throw new PafFormatError(`"${sheet.name}" has more than ${MAX_PAF_ROWS} rows`);
  }

  const columns = new Map<string, number>();
  header.forEach((cell, index) => {
    const key = headerKey(cell);
    // First occurrence wins if a header is repeated.
    if (key && !columns.has(key)) columns.set(key, index);
  });

  const records: TableRecord[] = [];
  body.forEach((cells, i) => {
    if (!cells.some((c) => toText(c) !== "")) return;
    const cell = (key: string) => {
      const index = columns.get(key);
      return index === undefined ? undefined : cells[index];
    };
    records.push({
      rowNumber: i + 2,
      text: (key) => toText(cell(key)),
      number: (key) => toNumber(cell(key)),
      date: (key) => toIsoDate(cell(key)),
    });
  });

  return { has: (key) => columns.has(key), records };
}

export function toText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).trim().slice(0, MAX_TEXT_LENGTH);
}

export function toNumber(value: CellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = toText(value).replace(/[₱,\s]/g, "");
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Reads a birthdate from an Excel date cell, "MM/DD/YYYY" text or "YYYY-MM-DD" text. */
export function toIsoDate(value: CellValue): { value: string; invalid: boolean } {
  if (value === null || value === undefined || toText(value) === "") return { value: "", invalid: false };
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? { value: "", invalid: true } : { value: value.toISOString().slice(0, 10), invalid: false };
  }
  const text = toText(value);
  let year: number, month: number, day: number;
  const us = US_DATE.exec(text);
  const iso = ISO_DATE.exec(text);
  if (us) [month, day, year] = [Number(us[1]), Number(us[2]), Number(us[3])];
  else if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return { value: "", invalid: true };

  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? { value: date.toISOString().slice(0, 10), invalid: false } : { value: "", invalid: true };
}

function mapText<K extends string>(record: TableRecord, columns: Partial<Record<K, string>>): Record<K, string> {
  const result = {} as Record<K, string>;
  for (const [field, key] of Object.entries(columns) as [K, string][]) result[field] = record.text(key);
  return result;
}

function mapNumbers<K extends string>(record: TableRecord, columns: Record<K, string>): Record<K, number | null> {
  const result = {} as Record<K, number | null>;
  for (const [field, key] of Object.entries(columns) as [K, string][]) result[field] = record.number(key);
  return result;
}

function hasAnyValue(values: object): boolean {
  return Object.values(values).some((v) => v !== "" && v !== null && v !== undefined);
}

/** Copies every non-empty value of `update` over `base`. Blank values never erase. */
export function mergeNonEmpty<T extends object>(base: T, update: Partial<T>): T {
  const result = { ...base };
  for (const [key, value] of Object.entries(update) as [keyof T, T[keyof T]][]) {
    if (value !== "" && value !== null && value !== undefined) result[key] = value;
  }
  return result;
}

export function emptyCorporate(): PafCorporate {
  return {
    legal_form: "",
    company_name: "",
    nature_of_business: "",
    office_address: "",
    office_phone: "",
    website: "",
    representative: "",
    representative_position: "",
  };
}

