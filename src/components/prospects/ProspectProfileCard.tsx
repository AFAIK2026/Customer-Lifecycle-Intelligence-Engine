import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronDown, Loader2, Sparkles } from "lucide-react";
import type { Client } from "@/types";
import type { ProspectProfile } from "@/lib/buyerIntelligence";
import type { ProspectAnalysisResponse, ProspectDriver } from "@/lib/prospectAnalysis";
import type { ProspectAnalysisState } from "@/hooks/useProspectAnalysis";
import { cn, formatDateTime } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { RuleBasedProspectView } from "@/components/prospects/RuleBasedProspectView";

/** Prospects listed in the panel when expanded. */
const TOP_PROSPECTS = 10;

interface ProspectProfileCardProps {
  analysis: ProspectAnalysisState;
  /** Rule-based profile used as the fallback. */
  ruleProfile: ProspectProfile;
  clients: Client[];
  displayName: (name: string) => string;
}

/**
 * High-Potential Prospect Profile: the Python model's result when available,
 * otherwise the rule-based profile with a badge saying why.
 */
export function ProspectProfileCard({ analysis, ruleProfile, clients, displayName }: ProspectProfileCardProps) {
  return (
    <Card className="intel-panel flex-1 p-5">
      <p className="text-sm text-foreground/90">
        Profile of high-potential prospects likely to convert or become high-value buyers.
      </p>
      {analysis.status === "ok" ? (
        <ModelView result={analysis.result} updating={analysis.updating} clients={clients} displayName={displayName} />
      ) : (
        <>
          {analysis.status === "loading" ? (
            <p className="model-badge mt-3">
              <Loader2 size={12} className="animate-spin" aria-hidden /> Analysing purchase data…
            </p>
          ) : (
            <p className="model-badge model-badge-fallback mt-3 flex-nowrap items-start">
              <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span>
                <span className="font-medium">Rule-based profile</span> · {analysis.reason}
              </span>
            </p>
          )}
          <RuleBasedProspectView profile={ruleProfile} hasCustomers={clients.length > 0} />
        </>
      )}
    </Card>
  );
}

function ModelView({
  result,
  updating,
  clients,
  displayName,
}: {
  result: ProspectAnalysisResponse;
  updating: boolean;
  clients: Client[];
  displayName: (name: string) => string;
}) {
  const { model, summary } = result;
  const trained = model.trained_on.repeat + model.trained_on.single;
  // Factors that raise likelihood first, then those that lower it (each already strongest first).
  const drivers = [...result.drivers.filter((d) => d.direction === "up"), ...result.drivers.filter((d) => d.direction === "down")];

  return (
    <>
      <p className="model-badge mt-3" title={model.method}>
        <Sparkles size={12} aria-hidden /> Python analysis · Logistic regression · AUC{" "}
        {model.cv_auc?.toFixed(2)} · {trained} customers
        {updating && <span className="text-muted-foreground"> · Updating…</span>}
      </p>

      <p className="mt-4 text-sm">
        <span className="font-mono text-2xl font-bold">{summary.high}</span>{" "}
        <span className="text-muted-foreground">high-potential</span>
        <span className="mx-2 text-muted-foreground">·</span>
        <span className="font-mono text-2xl font-bold">{summary.promising}</span>{" "}
        <span className="text-muted-foreground">promising prospects</span>
      </p>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        What predicts a repeat buyer
      </h4>
      {drivers.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No single factor is statistically supported yet; prospects are ranked on the combined pattern.
        </p>
      ) : (
        <ul className="mt-2 space-y-2 text-sm">
          {drivers.map((d) => (
            <DriverBullet key={d.feature} driver={d} />
          ))}
        </ul>
      )}

      <TopProspects result={result} clients={clients} displayName={displayName} />

      <p className="mt-4 text-xs text-muted-foreground">
        Base rate {model.base_rate !== null ? `${(model.base_rate * 100).toFixed(1)}%` : "—"} repeat buyers · only
        statistically supported factors are shown; "× as likely" describes an association, not a cause
        {model.analysed_at ? ` · analysed ${formatDateTime(model.analysed_at)}` : ""}
      </p>
    </>
  );
}

function DriverBullet({ driver }: { driver: ProspectDriver }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", driver.direction === "up" ? "bg-success" : "bg-muted-foreground")}
        aria-hidden
      />
      <span className="flex-1">
        {driver.label} — <span className="font-mono">{fmtRatio(driver.odds_ratio)}</span> as likely{" "}
        <span className="text-muted-foreground">
          ({fmtRatio(driver.ci_low, false)}–{fmtRatio(driver.ci_high)})
        </span>
      </span>
    </li>
  );
}

function TopProspects({
  result,
  clients,
  displayName,
}: {
  result: ProspectAnalysisResponse;
  clients: Client[];
  displayName: (name: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const top = result.prospects.filter((p) => byId.has(p.ref)).slice(0, TOP_PROSPECTS);
  if (top.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {open ? "Hide" : "View"} top prospects ({top.length})
        <ChevronDown size={12} className={cn("transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-border/60 rounded-md border border-border text-xs">
          {top.map((p) => {
            const client = byId.get(p.ref)!;
            return (
              <li key={p.ref} className="prospect-row">
                <Link to={`/clients/${client.id}`} className="truncate font-medium hover:text-primary hover:underline">
                  {displayName(client.name)}
                </Link>
                <span className="font-mono">{(p.probability * 100).toFixed(0)}%</span>
                <span className={cn("font-mono", p.tier === "high" ? "text-success" : "text-muted-foreground")}>
                  {p.lift.toFixed(1)}×
                </span>
                <span className="truncate text-muted-foreground" title={p.reasons.join(" · ")}>
                  {p.reasons.join(" · ") || "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function fmtRatio(value: number, suffix = true): string {
  return (value >= 1 ? value.toFixed(1) : value.toFixed(2)) + (suffix ? "×" : "");
}
