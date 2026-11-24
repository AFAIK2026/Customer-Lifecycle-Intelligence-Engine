import { Flag } from "lucide-react";
import type { CustomerFlag } from "@/lib/buyerIntelligence";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { FlagChip, PriorityPill, RecommendedAction } from "@/components/actions/ActionBadges";

/** Every action flag raised for one client, highest priority first. Renders nothing when there are none. */
export function RecommendedActionsCard({ flags }: { flags: CustomerFlag[] }) {
  if (flags.length === 0) return null;

  return (
    <Card className="intel-panel">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Flag size={16} className="text-primary" aria-hidden />
          <CardTitle>Recommended Actions</CardTitle>
        </div>
        <CardDescription>Why this client is on the dashboard's priority list, and what to do next.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border/60">
          {flags.map((f) => (
            <li key={f.flag} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,15rem)_1fr_minmax(0,1.2fr)_auto] sm:items-center">
              <span>
                <FlagChip flag={f.flag} />
              </span>
              <span className="text-sm text-muted-foreground">{f.keyIndicator}</span>
              <span className="text-sm">
                <RecommendedAction flag={f.flag} text={f.recommendedAction} />
              </span>
              <span className="sm:text-right">
                <PriorityPill priority={f.priority} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
