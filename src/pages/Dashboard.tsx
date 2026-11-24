import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  UsersRound,
  RefreshCw,
  Database,
  Flag,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { useAppData } from "@/context/AppDataContext";
import { groupForecastByType } from "@/lib/forecast";
import {
  ACTION_FLAG_LABELS,
  buildProspectProfile,
  buildRepeatBuyerPersona,
  computeCustomerActions,
  summarizeCustomerBase,
  type BuyerPersona,
  type CustomerAction,
  type ProspectProfile,
} from "@/lib/buyerIntelligence";
import { cn, formatCompactCurrency, formatCurrency, formatPercent, formatDateTime, milestoneBadgeClass } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FlagChip, PriorityPill, RecommendedAction } from "@/components/actions/ActionBadges";

/** Rows shown in the priority table before "View all" is expanded. */
const PRIORITY_PREVIEW_ROWS = 5;

export function Dashboard() {
  const { data, displayName, profileFor } = useAppData();
  const { clients, notifications } = data;

  const insights = useMemo(() => {
    const forecast = groupForecastByType(data);
    const inactiveIds = new Set(forecast.inactive.map((c) => c.id));
    return {
      forecast,
      summary: summarizeCustomerBase(data.clients),
      persona: buildRepeatBuyerPersona(data.clients, inactiveIds),
      prospects: buildProspectProfile(data.clients, inactiveIds),
      actions: computeCustomerActions(data, forecast, new Date(), (c) => profileFor(c)?.personal.birthdate),
    };
  }, [data, profileFor]);

  const { forecast, summary, persona, prospects, actions } = insights;
  const recent = notifications.slice(0, 8);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-powered customer intelligence for smarter engagement, lead generation, and lifecycle management.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={UsersRound} label="Total Customers" value={String(summary.totalCustomers)} caption="Customer base" />
        <StatCard
          icon={RefreshCw}
          label="Repeat Buyers"
          value={String(summary.repeatBuyers)}
          caption={`${summary.repeatBuyerShare.toFixed(1)}% of customers`}
        />
        <StatCard
          icon={Database}
          label="Avg. Repeat Buyer TSP"
          value={formatCompactCurrency(summary.avgRepeatBuyerTsp)}
          caption="Existing buyer segment"
          title={formatCurrency(summary.avgRepeatBuyerTsp)}
        />
        <StatCard
          icon={Flag}
          label="Customers for Review"
          value={String(actions.length)}
          caption="With recommended action"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col">
          <SectionHeading>Buyer Intelligence</SectionHeading>
          <BuyerPersonaCard persona={persona} />
        </section>
        <section className="flex flex-col">
          <SectionHeading>High-Potential Prospect Profile</SectionHeading>
          <ProspectProfileCard profile={prospects} hasCustomers={clients.length > 0} />
        </section>
      </div>

      <section>
        <PriorityActionsTable actions={actions} displayName={displayName} />
      </section>

      <section>
        <SectionHeading>Payment &amp; Milestone Monitoring</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <ForecastCard
            title="Approaching 10%"
            count={forecast.approaching10.length}
            className="forecast-approaching"
            icon={TrendingUp}
            iconClass="text-warning"
          />
          <ForecastCard
            title="Projected 10% (30d)"
            count={forecast.projected10Next30.length}
            className="forecast-approaching"
            icon={TrendingUp}
            iconClass="text-primary"
          />
          <ForecastCard
            title="Near CREQ"
            count={forecast.nearCreq.length}
            className="forecast-near-creq"
            icon={CheckCircle2}
            iconClass="text-success"
          />
          <ForecastCard
            title="Inactive Payments"
            count={forecast.inactive.length}
            className="forecast-inactive"
            icon={AlertTriangle}
            iconClass="text-destructive"
          />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <SectionHeading className="mb-0">Recent Milestones</SectionHeading>
          <Link to="/notifications" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        <Card>
          {recent.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No milestones triggered yet. Upload a Sales Report to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Milestone</th>
                    <th>Payment %</th>
                    <th>Timestamp</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((n) => (
                    <tr key={n.id}>
                      <td>
                        <Link to={`/clients/${n.client_id}`} className="hover:text-primary hover:underline">
                          {displayName(n.client_name)}
                        </Link>
                      </td>
                      <td>
                        <span className={milestoneBadgeClass(n.milestone)}>{n.milestone}</span>
                      </td>
                      <td className="font-mono">{formatPercent(n.payment_percentage)}</td>
                      <td className="text-muted-foreground">{formatDateTime(n.timestamp)}</td>
                      <td>
                        <Badge variant={n.email_sent ? "success" : "outline"}>{n.email_sent ? "Sent" : "Queued"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3", className)}>
      {children}
    </h2>
  );
}

function BuyerPersonaCard({ persona }: { persona: BuyerPersona | null }) {
  return (
    <Card className="intel-panel flex-1 p-5">
      <h3 className="text-sm font-bold uppercase tracking-wide">Summarized Buyer Persona</h3>
      {persona === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No repeat buyers yet. A persona appears once a customer holds two or more contracts.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">
            A summarized persona of a repeat buyer, based on {persona.sampleSize} repeat buyer
            {persona.sampleSize === 1 ? "" : "s"}.
          </p>
          <dl className="mt-4 divide-y divide-border/60 text-sm">
            <PersonaRow label="Buyer Type" value={persona.buyerType} />
            <PersonaRow label="Common Project" value={persona.commonProject} />
            <PersonaRow label="Typical Ownership" value={`${persona.typicalOwnership}+ Properties`} />
            <PersonaRow label="Customer Value" value={persona.customerValue} />
            <PersonaRow label="Engagement Trend" value={persona.engagementTrend} />
            <PersonaRow label="Lifecycle Stage" value={persona.lifecycleStage} />
          </dl>
        </>
      )}
    </Card>
  );
}

function PersonaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-2 gap-4 py-1.5">
      <dt className="font-semibold">{label}:</dt>
      <dd className="truncate text-foreground/90" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ProspectProfileCard({ profile, hasCustomers }: { profile: ProspectProfile; hasCustomers: boolean }) {
  const hasBaseline = profile.repeatBuyerProjects.length > 0;
  return (
    <Card className="intel-panel flex-1 p-5">
      <p className="text-sm text-foreground/90">
        Profile of high-potential prospects likely to convert or become high-value buyers.
      </p>
      {!hasCustomers || !hasBaseline ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Prospects are matched against existing repeat buyers. Upload a Sales Report that includes repeat buyers to
          build this profile.
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-2 text-sm">
            <ProspectBullet
              label="Similar to existing repeat / high-value buyers"
              count={profile.prospects.length}
              emphasis
            />
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
      )}
    </Card>
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

function PriorityActionsTable({
  actions,
  displayName,
}: {
  actions: CustomerAction[];
  displayName: (name: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const visible = expanded ? actions : actions.slice(0, PRIORITY_PREVIEW_ROWS);
  const canExpand = actions.length > PRIORITY_PREVIEW_ROWS;

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <SectionHeading className="mb-0">Customer Priority &amp; Recommended Actions</SectionHeading>
        {canExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            {expanded ? "Show less" : `View all (${actions.length})`}
            <ArrowRight size={12} className={cn("transition-transform", expanded && "-rotate-90")} />
          </button>
        )}
      </div>
      <Card>
        {actions.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No customers need follow-up right now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Flag / Opportunity</th>
                  <th>Key Indicator</th>
                  <th>Recommended Action</th>
                  <th className="text-right">Priority</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ client, primary, flags }) => {
                  const others = flags.slice(1);
                  const open = () => navigate(`/clients/${client.id}`);
                  return (
                    <tr
                      key={client.id}
                      className="row-link"
                      tabIndex={0}
                      aria-label={`Open ${displayName(client.name)}`}
                      onClick={(e) => {
                        // The name is already a link; don't navigate twice.
                        if (!(e.target as HTMLElement).closest("a")) open();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && e.target === e.currentTarget) open();
                      }}
                    >
                      <td className="font-medium">
                        <Link to={`/clients/${client.id}`} className="hover:text-primary hover:underline">
                          {displayName(client.name)}
                        </Link>
                      </td>
                      <td>
                        <FlagChip flag={primary.flag} />
                        {others.length > 0 && (
                          <span
                            className="ml-2 text-xs text-muted-foreground"
                            title={others.map((f) => ACTION_FLAG_LABELS[f.flag]).join(", ")}
                          >
                            +{others.length}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground">{primary.keyIndicator}</td>
                      <td>
                        <RecommendedAction flag={primary.flag} text={primary.recommendedAction} />
                      </td>
                      <td className="text-right">
                        <PriorityPill priority={primary.priority} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  caption,
  title,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  caption: string;
  title?: string;
}) {
  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon size={18} className="text-primary" aria-hidden />
      </div>
      <span className="font-mono text-2xl font-bold" title={title}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{caption}</span>
    </div>
  );
}

function ForecastCard({
  title,
  count,
  className,
  icon: Icon,
  iconClass,
}: {
  title: string;
  count: number;
  className: string;
  icon: LucideIcon;
  iconClass: string;
}) {
  return (
    <Link to="/forecast" className={`glass-card p-5 flex items-center justify-between ${className}`}>
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">{title}</p>
        <p className="text-2xl font-bold font-mono">{count}</p>
      </div>
      <Icon size={22} className={iconClass} aria-hidden />
    </Link>
  );
}
