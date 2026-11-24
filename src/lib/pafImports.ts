/**
 * Applying and removing PAF imports, and looking up a client's profile.
 *
 * Profiles are keyed by the customer's name key (same as customer_aliases),
 * not by client id, so they survive Sales Report removal and rebuilds, and a
 * profile for a customer not yet in the Sales Report attaches automatically
 * once a report adds them.
 */
import type {
  AppData,
  Client,
  ClientProfile,
  CompactPafRow,
  PafContact,
  PafBuyer,
  PafEmployment,
  PafImportRecord,
  PafPersonal,
  PafRow,
} from "@/types";
import { aliasKey, assignAliases } from "@/lib/customerAliases";
import { emptyCorporate, mergeNonEmpty } from "@/lib/paf";

export interface ApplyPafImportInput {
  fileName: string;
  rows: PafRow[];
  /** Defaults to now. */
  importedAt?: string;
}

export interface PafRowMatch {
  row: PafRow;
  /** The client the row was matched to, or null when the customer isn't in the Sales Report data yet. */
  clientId: string | null;
}

export interface ApplyPafImportResult {
  data: AppData;
  record: PafImportRecord;
  matches: PafRowMatch[];
}

/** Contract numbers compared without spaces or dashes, so formatting differences don't block a match. */
export function normalizeContractNumber(value: string): string {
  return value.replace(/[\s-]/g, "").toLowerCase();
}

/** Finds a row's client: by contract number first, then by customer name. */
export function createClientMatcher(
  clients: Client[]
): (row: Pick<CompactPafRow, "contract_number" | "customer_name">) => Client | undefined {
  const byContract = new Map<string, Client>();
  const byName = new Map<string, Client>();
  for (const client of clients) {
    byName.set(aliasKey(client.name), client);
    for (const contract of client.contracts) byContract.set(normalizeContractNumber(contract.contract_number), client);
  }
  return (row) =>
    (row.contract_number && byContract.get(normalizeContractNumber(row.contract_number))) ||
    (row.customer_name ? byName.get(aliasKey(row.customer_name)) : undefined);
}

/** Records a PAF workbook and merges its rows into client_profiles. */
export function applyPafImport(data: AppData, input: ApplyPafImportInput): ApplyPafImportResult {
  const importId = crypto.randomUUID();
  const importedAt = input.importedAt ?? new Date().toISOString();
  const match = createClientMatcher(data.clients);

  const matches: PafRowMatch[] = input.rows.map((row) => ({ row, clientId: match(row)?.id ?? null }));
  const matched = matches.filter((m) => m.clientId !== null).length;

  const record: PafImportRecord = {
    id: importId,
    file_name: input.fileName,
    imported_at: importedAt,
    row_count: input.rows.length,
    matched,
    unmatched: input.rows.length - matched,
    rows: input.rows.map(compactPafRow),
  };

  const client_profiles = mergeRows(data.client_profiles, input.rows, data.clients, importId, importedAt);
  return {
    data: {
      ...data,
      client_profiles,
      paf_imports: [...data.paf_imports, record],
      // Customers known only from a PAF get their permanent "Customer N" label now.
      // Matched rows already have one through their client, even if the PAF spells the name differently.
      customer_aliases: assignAliases(
        data.customer_aliases,
        matches.filter((m) => m.clientId === null && m.row.customer_name).map((m) => m.row.customer_name)
      ),
    },
    record,
    matches,
  };
}

/** Removes a PAF import and rebuilds every profile from the remaining imports, oldest first. */
export function removePafImport(data: AppData, importId: string): AppData {
  const remaining = data.paf_imports.filter((r) => r.id !== importId);
  if (remaining.length === data.paf_imports.length) return data;

  let profiles: Record<string, ClientProfile> = {};
  for (const record of remaining) {
    profiles = mergeRows(profiles, record.rows, data.clients, record.id, record.imported_at);
  }
  return { ...data, client_profiles: profiles, paf_imports: remaining };
}

function mergeRows(
  existing: Record<string, ClientProfile>,
  rows: CompactPafRow[],
  clients: Client[],
  importId: string,
  importedAt: string
): Record<string, ClientProfile> {
  const match = createClientMatcher(clients);
  const profiles = { ...existing };

  for (const row of rows) {
    const client = match(row);
    const key = profileKey(row, client);
    if (!key) continue;
    const base = profiles[key] ?? emptyProfile();
    profiles[key] = {
      customer_number: row.customer_number || base.customer_number,
      customer_name: client?.name || row.customer_name || base.customer_name,
      contract_numbers: row.contract_number
        ? [...new Set([...base.contract_numbers, row.contract_number])]
        : base.contract_numbers,
      personal: mergeNonEmpty(base.personal, row.personal),
      contact: mergeNonEmpty(base.contact, row.contact),
      buyer: mergeNonEmpty(base.buyer, row.buyer),
      employment: mergeNonEmpty(base.employment, row.employment),
      corporate: row.corporate ? mergeNonEmpty(base.corporate ?? emptyCorporate(), row.corporate) : base.corporate,
      spouse: row.spouse ? mergeNonEmpty(base.spouse ?? emptySpouse(), row.spouse) : base.spouse,
      source_import_id: importId,
      updated_at: importedAt,
    };
  }
  return profiles;
}

function profileKey(row: CompactPafRow, client: Client | undefined): string | null {
  if (client) return aliasKey(client.name);
  if (row.customer_name) return aliasKey(row.customer_name);
  // No name and no matching client: key by contract so the row isn't lost.
  return row.contract_number ? `contract:${normalizeContractNumber(row.contract_number)}` : null;
}

/** Drops empty fields so import records take less browser storage. */
export function compactPafRow(row: PafRow): CompactPafRow {
  const compact: CompactPafRow = {
    personal: dropEmpty(row.personal),
    contact: dropEmpty(row.contact),
    buyer: dropEmpty(row.buyer),
    employment: dropEmpty(row.employment),
  };
  if (row.customer_number) compact.customer_number = row.customer_number;
  if (row.contract_number) compact.contract_number = row.contract_number;
  if (row.customer_name) compact.customer_name = row.customer_name;
  if (row.corporate) compact.corporate = dropEmpty(row.corporate);
  if (row.spouse) compact.spouse = dropEmpty(row.spouse);
  return compact;
}

function dropEmpty<T extends object>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  ) as Partial<T>;
}

const EMPTY_PERSONAL: PafPersonal = {
  family_name: "",
  first_name: "",
  middle_name: "",
  sex: "",
  birthdate: "",
  citizenship: "",
  civil_status: "",
  id_type: "",
};
const EMPTY_CONTACT: PafContact = { home_address: "", mailing_address: "", mobile: "", home_phone: "", office_phone: "", email: "" };
const EMPTY_BUYER: PafBuyer = { buyer_role: "", buyer_type: "", authorized_representative: "" };
const EMPTY_EMPLOYMENT: PafEmployment = {
  occupation: "",
  employment_type: "",
  employment_status: "",
  employer: "",
  position: "",
  years_in_work: null,
  business_address: "",
  gross_monthly_income: null,
};

function emptySpouse(): NonNullable<ClientProfile["spouse"]> {
  return {
    family_name: "",
    first_name: "",
    middle_name: "",
    sex: "",
    birthdate: "",
    citizenship: "",
    occupation: "",
    employment_type: "",
    employment_status: "",
    employer: "",
    position: "",
    years_in_work: null,
    gross_monthly_income: null,
    mobile: "",
    email: "",
  };
}

function emptyProfile(): ClientProfile {
  return {
    customer_number: "",
    customer_name: "",
    contract_numbers: [],
    personal: { ...EMPTY_PERSONAL },
    contact: { ...EMPTY_CONTACT },
    buyer: { ...EMPTY_BUYER },
    employment: { ...EMPTY_EMPLOYMENT },
    corporate: null,
    spouse: null,
    source_import_id: "",
    updated_at: "",
  };
}

/**
 * Returns a lookup from client to profile: by name key first, then by any
 * shared contract number (for forms filed under a differently spelled name).
 */
export function createProfileLookup(data: AppData): (client: Client) => ClientProfile | undefined {
  const byContract = new Map<string, ClientProfile>();
  for (const profile of Object.values(data.client_profiles)) {
    for (const number of profile.contract_numbers) byContract.set(normalizeContractNumber(number), profile);
  }
  return (client) => {
    const direct = data.client_profiles[aliasKey(client.name)];
    if (direct) return direct;
    for (const contract of client.contracts) {
      const found = byContract.get(normalizeContractNumber(contract.contract_number));
      if (found) return found;
    }
    return undefined;
  };
}
