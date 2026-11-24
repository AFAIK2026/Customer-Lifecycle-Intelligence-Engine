import type { Notification, WeeklyReport } from "@/types";
import { isoWeekRange } from "@/lib/utils";

/** Groups notifications into ISO weeks (Monday–Sunday), newest week first, milestones newest first. */
export function groupByWeek(notifications: Notification[]): WeeklyReport[] {
  const byWeek = new Map<string, WeeklyReport>();
  for (const n of notifications) {
    const { start, end } = isoWeekRange(n.timestamp);
    let report = byWeek.get(start);
    if (!report) {
      report = { week_start: start, week_end: end, milestones: [] };
      byWeek.set(start, report);
    }
    report.milestones.push(n);
  }
  const reports = [...byWeek.values()].sort((a, b) => b.week_start.localeCompare(a.week_start));
  for (const r of reports) r.milestones.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return reports;
}

/** Stable, readable week id for URLs: the week's Monday as YYYY-MM-DD (local date). */
export function weekId(report: Pick<WeeklyReport, "week_start">): string {
  const d = new Date(report.week_start);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Milestone counts for a week, in a fixed display order. */
export function summarizeWeek(report: WeeklyReport): { milestone: string; count: number }[] {
  const order = ["10% Payment", "CREQ", "Projected 10% (Next 30 Days)"];
  const counts = new Map<string, number>();
  for (const n of report.milestones) counts.set(n.milestone, (counts.get(n.milestone) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a[0].localeCompare(b[0]);
    })
    .map(([milestone, count]) => ({ milestone, count }));
}
