export const REQUIRED_DOCS = [
  "Valid ID",
  "Proof of Income",
  "Tax Returns",
  "Bank Statements",
  "Reservation Agreement",
  "Contract to Sell",
  "Title Documents",
  "Transfer Certificate",
] as const;

export type RequiredDoc = (typeof REQUIRED_DOCS)[number];

export interface DocumentationStatus {
  required: string[];
  submitted: string[];
  missing: string[];
}

export interface Contract {
  contract_number: string;
  project_code: string;
  project_name: string;
  credit_date: string;
  contract_value: number;
  payment_percentage: number;
  payment_to_date: number;
}

export interface ContractPaymentHistory {
  contract_number: string;
  date: string;
  payment_percentage: number;
}

export interface Client {
  id: string;
  name: string;
  contract_value: number;
  payment_to_date: number;
  payment_percentage: number;
  documentation_status: DocumentationStatus;
  milestones_reached: string[];
  created_at: string;
  contracts: Contract[];
  projected_10_alert_sent: boolean;
}

export interface PaymentHistory {
  client_id: string;
  date: string;
  payment_percentage: number;
}

export type MilestoneName = "10% Payment" | "CREQ";

export interface Milestone {
  name: MilestoneName;
  rule: string;
}

export type ForecastFlagType = "approaching_10" | "near_creq" | "inactive" | "projected_10_next_30";

export interface ForecastFlag {
  client_id: string;
  type: ForecastFlagType;
  generated_date: string;
}

export type NotificationKind = "milestone" | "forecast";

export interface Notification {
  id: string;
  client_id: string;
  client_name: string;
  milestone: MilestoneName | "Projected 10% (Next 30 Days)";
  payment_percentage: number;
  timestamp: string;
  email_sent: boolean;
  sent_to: string;
  kind: NotificationKind;
  /** The import that generated this notification; absent for manual (documentation) triggers. */
  import_id?: string;
}

export interface WeeklyReport {
  week_start: string;
  week_end: string;
  milestones: Notification[];
}

export interface AppSettings {
  alert_email: string;
  /** When true, customer names are shown as "Customer N" everywhere in the app. */
  hide_customer_names: boolean;
}

/** One parsed Sales Report row, as stored on an import so it can be replayed. */
export interface SalesReportRow {
  name: string;
  contract_number: string;
  project_code: string;
  project_name: string;
  credit_date: string;
  contract_value: number;
  payment_percentage: number;
}

/** A Sales Report file that was imported. Its rows are kept so the import can be removed later. */
export interface ImportRecord {
  id: string;
  file_name: string;
  imported_at: string;
  row_count: number;
  customers_processed: number;
  rows: SalesReportRow[];
}

/**
 * Payment data that existed before import tracking was introduced. It has no
 * source file, so it cannot be removed; imports are replayed on top of it.
 */
export interface ImportBaseline {
  captured_at: string;
  clients: Client[];
  payment_history: PaymentHistory[];
  contract_payment_history: ContractPaymentHistory[];
}

/** Personal details from the Purchase Application Form. */
export interface PafPersonal {
  family_name: string;
  first_name: string;
  middle_name: string;
  sex: string;
  /** ISO date (YYYY-MM-DD). */
  birthdate: string;
  citizenship: string;
  civil_status: string;
  /** Type of government ID presented. The ID number itself is never imported. */
  id_type: string;
}

export interface PafContact {
  home_address: string;
  mailing_address: string;
  mobile: string;
  home_phone: string;
  office_phone: string;
  email: string;
}

export interface PafBuyer {
  buyer_role: string;
  buyer_type: string;
  authorized_representative: string;
}

export interface PafEmployment {
  occupation: string;
  employment_type: string;
  employment_status: string;
  employer: string;
  position: string;
  years_in_work: number | null;
  business_address: string;
  gross_monthly_income: number | null;
}

export interface PafCorporate {
  legal_form: string;
  company_name: string;
  nature_of_business: string;
  office_address: string;
  office_phone: string;
  website: string;
  representative: string;
  representative_position: string;
}

export interface PafSpouse {
  family_name: string;
  first_name: string;
  middle_name: string;
  sex: string;
  birthdate: string;
  citizenship: string;
  occupation: string;
  employment_type: string;
  employment_status: string;
  employer: string;
  position: string;
  years_in_work: number | null;
  gross_monthly_income: number | null;
  mobile: string;
  email: string;
}

/**
 * One customer's row from a PAF workbook, with any linked spouse and
 * corporate rows. Government ID numbers and TINs are dropped while parsing.
 */
export interface PafRow {
  customer_number: string;
  contract_number: string;
  customer_name: string;
  personal: PafPersonal;
  contact: PafContact;
  buyer: PafBuyer;
  employment: PafEmployment;
  corporate: PafCorporate | null;
  spouse: PafSpouse | null;
}

/** Client details merged from every PAF import, latest non-empty value per field. */
export interface ClientProfile {
  customer_number: string;
  customer_name: string;
  contract_numbers: string[];
  personal: PafPersonal;
  contact: PafContact;
  buyer: PafBuyer;
  employment: PafEmployment;
  corporate: PafCorporate | null;
  spouse: PafSpouse | null;
  /** The import that last changed this profile. */
  source_import_id: string;
  updated_at: string;
}

/**
 * A PafRow as saved on an import record: empty fields are left out to save
 * browser storage. Replaying it gives the same result, since blanks never
 * overwrite values anyway.
 */
export interface CompactPafRow {
  customer_number?: string;
  contract_number?: string;
  customer_name?: string;
  personal: Partial<PafPersonal>;
  contact: Partial<PafContact>;
  buyer: Partial<PafBuyer>;
  employment: Partial<PafEmployment>;
  corporate?: Partial<PafCorporate> | null;
  spouse?: Partial<PafSpouse> | null;
}

/** A PAF workbook that was imported. Its rows are kept so it can be removed later. */
export interface PafImportRecord {
  id: string;
  file_name: string;
  imported_at: string;
  row_count: number;
  /** Rows matched to a client already in the Sales Report data (at import time). */
  matched: number;
  /** Rows kept for customers not yet in the Sales Report data (at import time). */
  unmatched: number;
  rows: CompactPafRow[];
}

export interface AppData {
  clients: Client[];
  payment_history: PaymentHistory[];
  contract_payment_history: ContractPaymentHistory[];
  notifications: Notification[];
  settings: AppSettings;
  /** Imported files, oldest first. */
  imports: ImportRecord[];
  baseline: ImportBaseline | null;
  /** Permanent display number per customer, keyed by lowercased name. See lib/customerAliases. */
  customer_aliases: Record<string, number>;
  /** Client details from Purchase Application Forms, keyed by lowercased customer name. See lib/pafImports. */
  client_profiles: Record<string, ClientProfile>;
  /** Imported PAF workbooks, oldest first. */
  paf_imports: PafImportRecord[];
}
