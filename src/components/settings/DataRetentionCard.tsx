import { ShieldCheck, Trash2 } from "lucide-react";
import { useAppData } from "@/context/AppDataContext";
import { IDLE_SHIELD_MINUTES, RETENTION_OPTIONS, purgeDate, type RetentionDays } from "@/lib/retention";
import { formatDate } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Retention period and manual clear for the data CLIE keeps in this browser. */
export function DataRetentionCard() {
  const { retention, setRetentionDays, clearAllData } = useAppData();

  function handleClear() {
    const confirmed = window.confirm(
      "Delete all CLIE data on this computer?\n\nClients, payments, milestones, client details and import history will be removed. Your original files are not affected; upload them again to restore."
    );
    if (confirmed) clearAllData();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-primary" />
          <CardTitle>Data Retention</CardTitle>
        </div>
        <CardDescription>
          CLIE keeps a working copy of your uploaded reports in this browser only. For security it is deleted
          automatically when the app isn't used, and the screen is hidden after {IDLE_SHIELD_MINUTES} minutes without
          activity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="retention-days" className="text-sm">
            Delete data after
          </label>
          <select
            id="retention-days"
            value={retention.retention_days}
            onChange={(e) => setRetentionDays(Number(e.target.value) as RetentionDays)}
            className="week-select"
          >
            {RETENTION_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days without use{days === 14 ? " (recommended)" : ""}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            If CLIE isn't opened again, data will be cleared on {formatDate(purgeDate(retention).toISOString())}.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={handleClear}>
            <Trash2 size={14} /> Clear all data now
          </Button>
          <span className="text-xs text-muted-foreground">
            Use before handing over or returning this computer.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
