import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useAppData } from "@/context/AppDataContext";
import { formatDate, formatPercent, milestoneBadgeClass } from "@/lib/utils";
import { groupByWeek, summarizeWeek, weekId } from "@/lib/weeklyReports";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { WeeklyReport } from "@/types";

function toCsvField(value: string | number | boolean): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function Reports() {
  const { data, displayName } = useAppData();

  const weeklyReports: WeeklyReport[] = useMemo(() => groupByWeek(data.notifications), [data.notifications]);
  const [searchParams, setSearchParams] = useSearchParams();

  // The selected week lives in the URL (?week=YYYY-MM-DD) so Back and shared links keep it.
  const requested = searchParams.get("week");
  const selectedIndex = Math.max(0, weeklyReports.findIndex((r) => weekId(r) === requested));
  const report = weeklyReports[selectedIndex];

  function selectWeek(index: number) {
    const target = weeklyReports[index];
    if (target) setSearchParams({ week: weekId(target) });
  }

  function exportReport(report: WeeklyReport) {
    const header = "client_name,milestone,payment_percentage,timestamp,email_sent";
    const rows = report.milestones.map((n) =>
      [
        toCsvField(displayName(n.client_name)),
        toCsvField(n.milestone),
        toCsvField(n.payment_percentage.toFixed(2)),
        toCsvField(n.timestamp),
        toCsvField(n.email_sent),
      ].join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `weekly-report-${formatDate(report.week_start).replace(/\s|,/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Weekly Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Milestones grouped by ISO week, ready to export and share.
        </p>
      </div>

      {weeklyReports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No milestone activity recorded yet.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="week-select" className="text-sm text-muted-foreground">
              Week
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectWeek(selectedIndex + 1)}
              disabled={selectedIndex >= weeklyReports.length - 1}
              aria-label="Previous week"
            >
              <ChevronLeft size={14} />
            </Button>
            <select
              id="week-select"
              value={weekId(report)}
              onChange={(e) => selectWeek(weeklyReports.findIndex((r) => weekId(r) === e.target.value))}
              className="week-select"
            >
              {weeklyReports.map((r, i) => (
                <option key={r.week_start} value={weekId(r)}>
                  {formatDate(r.week_start)} – {formatDate(r.week_end)} ({r.milestones.length})
                  {i === 0 ? " · latest" : ""}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectWeek(selectedIndex - 1)}
              disabled={selectedIndex <= 0}
              aria-label="Next week"
            >
              <ChevronRight size={14} />
            </Button>
            <span className="text-xs text-muted-foreground">
              {weeklyReports.length} week{weeklyReports.length === 1 ? "" : "s"} with milestone activity
            </span>
          </div>

          <Card key={report.week_start}>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>
                  Week of {formatDate(report.week_start)} – {formatDate(report.week_end)}
                </CardTitle>
                <CardDescription>{report.milestones.length} milestone(s) triggered</CardDescription>
              </div>
              <Button size="sm" variant="outline" onClick={() => exportReport(report)}>
                <Download size={14} /> Export CSV
              </Button>
            </CardHeader>
            <CardContent className="pt-0 space-y-4">
              <ul className="flex flex-wrap gap-2" aria-label="Milestones this week">
                {summarizeWeek(report).map(({ milestone, count }) => (
                  <li key={milestone} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                    <span className={milestoneBadgeClass(milestone)}>{milestone}</span>
                    <span className="font-mono font-semibold">{count}</span>
                  </li>
                ))}
              </ul>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Client</th>
                      <th>Milestone</th>
                      <th>Payment %</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.milestones.map((n) => (
                      <tr key={n.id}>
                        <td>{displayName(n.client_name)}</td>
                        <td>
                          <span className={milestoneBadgeClass(n.milestone)}>{n.milestone}</span>
                        </td>
                        <td className="font-mono">{formatPercent(n.payment_percentage)}</td>
                        <td className="text-muted-foreground">{formatDate(n.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
