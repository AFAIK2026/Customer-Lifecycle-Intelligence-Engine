import { useState } from "react";
import { Link } from "react-router-dom";
import { IdCard } from "lucide-react";
import type { ClientProfile, PafImportRecord } from "@/types";
import { birthdateWithAge, cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

type TabId = "personal" | "contact" | "employment" | "spouse" | "corporate";

interface Field {
  label: string;
  value: string | number | null | undefined;
  /** Personal data hidden while "Customer names hidden" is on. */
  sensitive?: boolean;
}

interface ClientProfileCardProps {
  profile: ClientProfile | undefined;
  source: PafImportRecord | undefined;
  /** True while "Customer names hidden" is on. */
  masked: boolean;
  now?: Date;
}

/** Purchase Application Form details for one client, grouped into tabs. */
export function ClientProfileCard({ profile, source, masked, now = new Date() }: ClientProfileCardProps) {
  const [tab, setTab] = useState<TabId>("personal");

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <ProfileTitle />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No Purchase Application Form on file.{" "}
            <Link to="/upload-paf" className="text-primary hover:underline">
              Upload one on the Upload PAF page.
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  const tabs = buildTabs(profile, now);
  const active = tabs.find((t) => t.id === tab && t.fields) ?? tabs[0];

  return (
    <Card>
      <CardHeader>
        <ProfileTitle />
        <CardDescription>
          Source: Purchase Application Form
          {source ? ` · ${source.file_name} · ${formatDateTime(source.imported_at)}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="tablist" aria-label="Client profile sections" className="profile-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`profile-tab-${t.id}`}
              aria-selected={active.id === t.id}
              aria-controls="profile-panel"
              disabled={!t.fields}
              onClick={() => setTab(t.id)}
              className="profile-tab"
            >
              {t.label}
            </button>
          ))}
        </div>
        <dl id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${active.id}`} className="profile-grid">
          {active.fields!.map((field) => (
            <div key={field.label} className="contents">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className={cn("break-words", masked && field.sensitive && "italic text-muted-foreground")}>
                {display(field, masked)}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function ProfileTitle() {
  return (
    <div className="flex items-center gap-2">
      <IdCard size={16} className="text-muted-foreground" aria-hidden />
      <CardTitle>Client Profile</CardTitle>
    </div>
  );
}

function display(field: Field, masked: boolean): string {
  if (field.value === null || field.value === undefined || field.value === "") return "—";
  if (masked && field.sensitive) return "Hidden";
  return String(field.value);
}

function buildTabs(p: ClientProfile, now: Date): { id: TabId; label: string; fields: Field[] | null }[] {
  const { personal, contact, buyer, employment, spouse, corporate } = p;
  return [
    {
      id: "personal",
      label: "Personal",
      fields: [
        { label: "Full name", value: fullName(personal.family_name, personal.first_name, personal.middle_name), sensitive: true },
        { label: "Birthdate", value: birthdateWithAge(personal.birthdate, now), sensitive: true },
        { label: "Sex", value: personal.sex },
        { label: "Citizenship", value: personal.citizenship },
        { label: "Customer number", value: p.customer_number },
        { label: "Contract numbers", value: p.contract_numbers.join(", ") },
      ],
    },
    {
      id: "contact",
      label: "Contact",
      fields: [
        { label: "Mobile", value: contact.mobile, sensitive: true },
        { label: "E-mail", value: contact.email, sensitive: true },
        { label: "Home telephone", value: contact.home_phone, sensitive: true },
        { label: "Office telephone", value: contact.office_phone, sensitive: true },
        { label: "Home address", value: contact.home_address, sensitive: true },
        { label: "Mailing address", value: contact.mailing_address, sensitive: true },
      ],
    },
    {
      id: "employment",
      label: "Buyer & Employment",
      fields: [
        { label: "Buyer type", value: buyer.buyer_type },
        { label: "Buyer role", value: buyer.buyer_role },
        { label: "Authorized representative", value: buyer.authorized_representative, sensitive: true },
        { label: "Occupation", value: employment.occupation },
        { label: "Employment type", value: employment.employment_type },
        { label: "Employment status", value: employment.employment_status },
        { label: "Employer / business", value: employment.employer, sensitive: true },
        { label: "Position", value: employment.position },
        { label: "Years in current work", value: employment.years_in_work },
        { label: "Business address", value: employment.business_address, sensitive: true },
        { label: "Gross monthly income", value: money(employment.gross_monthly_income) },
      ],
    },
    {
      id: "spouse",
      label: "Spouse",
      fields: spouse && [
        { label: "Full name", value: fullName(spouse.family_name, spouse.first_name, spouse.middle_name), sensitive: true },
        { label: "Birthdate", value: birthdateWithAge(spouse.birthdate, now), sensitive: true },
        { label: "Sex", value: spouse.sex },
        { label: "Citizenship", value: spouse.citizenship },
        { label: "Mobile", value: spouse.mobile, sensitive: true },
        { label: "E-mail", value: spouse.email, sensitive: true },
        { label: "Occupation", value: spouse.occupation },
        { label: "Employment type", value: spouse.employment_type },
        { label: "Employment status", value: spouse.employment_status },
        { label: "Employer / business", value: spouse.employer, sensitive: true },
        { label: "Position", value: spouse.position },
        { label: "Years in current work", value: spouse.years_in_work },
        { label: "Gross monthly income", value: money(spouse.gross_monthly_income) },
      ],
    },
    {
      id: "corporate",
      label: "Corporate",
      fields: corporate && [
        { label: "Company name", value: corporate.company_name, sensitive: true },
        { label: "Legal form", value: corporate.legal_form },
        { label: "Nature of business", value: corporate.nature_of_business },
        { label: "Office address", value: corporate.office_address, sensitive: true },
        { label: "Office telephone", value: corporate.office_phone, sensitive: true },
        { label: "Website", value: corporate.website },
        { label: "Representative", value: corporate.representative, sensitive: true },
        { label: "Representative position", value: corporate.representative_position },
      ],
    },
  ];
}

function fullName(family: string, first: string, middle: string): string {
  const given = [first, middle].filter(Boolean).join(" ");
  return [family, given].filter(Boolean).join(", ");
}

function money(value: number | null): string {
  return value === null ? "" : formatCurrency(value);
}
