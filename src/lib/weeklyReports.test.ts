import { describe, expect, it } from "vitest";
import type { Notification } from "@/types";
import { groupByWeek, summarizeWeek, weekId } from "@/lib/weeklyReports";

function n(id: string, timestamp: string, milestone: Notification["milestone"] = "10% Payment"): Notification {
  return {
    id,
    client_id: "c",
    client_name: "Client",
    milestone,
    payment_percentage: 10,
    timestamp,
    email_sent: true,
    sent_to: "a@example.com",
    kind: "milestone",
  };
}

describe("groupByWeek", () => {
  it("groups by Monday–Sunday week, newest week and newest milestone first", () => {
    const weeks = groupByWeek([
      n("a", "2026-11-10T10:00:00"), // Tue, week of Nov 9
      n("b", "2026-11-24T09:00:00"), // Tue, week of Nov 23
      n("c", "2026-11-29T20:00:00"), // Sun, still week of Nov 23
      n("d", "2026-11-30T08:00:00"), // Mon, week of Nov 30
    ]);
    expect(weeks.map(weekId)).toEqual(["2026-11-30", "2026-11-23", "2026-11-09"]);
    expect(weeks[1].milestones.map((m) => m.id)).toEqual(["c", "b"]);
  });

  it("returns no weeks without notifications", () => {
    expect(groupByWeek([])).toEqual([]);
  });
});

describe("summarizeWeek", () => {
  it("counts milestones in a fixed order", () => {
    const [week] = groupByWeek([
      n("a", "2026-11-24T09:00:00", "CREQ"),
      n("b", "2026-11-24T09:00:00", "10% Payment"),
      n("c", "2026-11-25T09:00:00", "Projected 10% (Next 30 Days)"),
      n("d", "2026-11-25T09:00:00", "10% Payment"),
    ]);
    expect(summarizeWeek(week)).toEqual([
      { milestone: "10% Payment", count: 2 },
      { milestone: "CREQ", count: 1 },
      { milestone: "Projected 10% (Next 30 Days)", count: 1 },
    ]);
  });
});

describe("isoWeekRange keys", () => {
  it("gives every moment of a week the same key", () => {
    const keys = new Set(
      ["2026-11-23T00:00:00", "2026-11-24T09:00:00", "2026-11-26T23:59:00", "2026-11-29T23:59:59"].map(
        (t) => groupByWeek([n("x", t)])[0].week_start
      )
    );
    expect(keys.size).toBe(1);
  });
});
