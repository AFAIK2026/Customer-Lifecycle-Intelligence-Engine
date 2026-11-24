import type { ProspectProfile } from "@/lib/buyerIntelligence";
import { cn, formatCompactCurrency } from "@/lib/utils";

/** The original rule-based prospect profile, shown when the Python analysis can't be used. */
export function RuleBasedProspectView({ profile, hasCustomers }: { profile: ProspectProfile; hasCustomers: boolean }) {
  const hasBaseline = profile.repeatBuyerProjects.length > 0;
  if (!hasCustomers || !hasBaseline) {
    return (
      <p className="mt-3 text-sm text-muted-foreground">
        Prospects are matched against existing repeat buyers. Upload a Sales Report that includes repeat buyers to build
        this profile.
      </p>
    );
  }
  return (
    <>
      <ul className="mt-4 space-y-2 text-sm">
        <ProspectBullet label="Similar to existing repeat / high-value buyers" count={profile.prospects.length} emphasis />
        {profile.criteria.map((c) => (
          <ProspectBullet key={c.id} label={c.label} count={c.matches} />
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">
        Single-contract customers meeting 3 of 4 criteria. Premium bar:{" "}
        <span className="font-mono">{formatCompactCurrency(profile.premiumThreshold)}</span> · Top projects:{" "}
        {profile.repeatBuyerProjects.join(", ")}
      </p>
    </>
  );
}

function ProspectBullet({ label, count, emphasis }: { label: string; count: number; emphasis?: boolean }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden />
      <span className={cn("flex-1", emphasis && "font-semibold")}>{label}</span>
      <span className="font-mono text-xs text-muted-foreground" aria-label={`${count} customers`}>
        {count}
      </span>
    </li>
  );
}
