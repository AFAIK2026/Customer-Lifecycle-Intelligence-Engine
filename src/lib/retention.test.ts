import { describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_KEY,
  DEFAULT_RETENTION_DAYS,
  enforceRetentionOnStartup,
  isExpired,
  purgeDate,
  readActivity,
  touchActivity,
  type KeyValueStore,
} from "@/lib/retention";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const NOW = new Date("2026-11-24T08:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function storeWith(lastActive: string, retention = 14, extra: object = {}) {
  return memoryStore({ [ACTIVITY_KEY]: JSON.stringify({ last_active: lastActive, retention_days: retention, ...extra }) });
}

describe("enforceRetentionOnStartup", () => {
  it("purges when the app wasn't used within the retention period", () => {
    const store = storeWith(daysAgo(14));
    const purge = vi.fn();
    expect(enforceRetentionOnStartup(store, purge, NOW)).toBe(true);
    expect(purge).toHaveBeenCalledOnce();
    expect(readActivity(store)).toEqual({ last_active: NOW.toISOString(), retention_days: 14, purged_at: NOW.toISOString() });
  });

  it("keeps data used within the period and refreshes the clock", () => {
    const store = storeWith(daysAgo(13.9));
    const purge = vi.fn();
    expect(enforceRetentionOnStartup(store, purge, NOW)).toBe(false);
    expect(purge).not.toHaveBeenCalled();
    expect(readActivity(store)?.last_active).toBe(NOW.toISOString());
  });

  it("respects a shorter or longer retention setting", () => {
    expect(enforceRetentionOnStartup(storeWith(daysAgo(8), 7), vi.fn(), NOW)).toBe(true);
    expect(enforceRetentionOnStartup(storeWith(daysAgo(20), 30), vi.fn(), NOW)).toBe(false);
  });

  it("starts the clock instead of purging data saved before retention existed", () => {
    const store = memoryStore();
    const purge = vi.fn();
    expect(enforceRetentionOnStartup(store, purge, NOW)).toBe(false);
    expect(purge).not.toHaveBeenCalled();
    expect(readActivity(store)).toEqual({ last_active: NOW.toISOString(), retention_days: DEFAULT_RETENTION_DAYS });
  });

  it("treats an unreadable activity record as missing", () => {
    const store = memoryStore({ [ACTIVITY_KEY]: "{broken" });
    expect(enforceRetentionOnStartup(store, vi.fn(), NOW)).toBe(false);
  });
});

describe("touchActivity", () => {
  it("records use at most once a minute and keeps the setting", () => {
    const store = storeWith(new Date(NOW.getTime() - 30_000).toISOString(), 30);
    touchActivity(store, NOW);
    expect(readActivity(store)?.last_active).toBe(new Date(NOW.getTime() - 30_000).toISOString());

    const later = new Date(NOW.getTime() + 61_000);
    touchActivity(store, later);
    expect(readActivity(store)).toMatchObject({ last_active: later.toISOString(), retention_days: 30 });
  });
});

describe("isExpired / purgeDate", () => {
  it("computes the purge date from the last use", () => {
    const record = { last_active: "2026-11-24T08:00:00.000Z", retention_days: 14 as const };
    expect(purgeDate(record).toISOString()).toBe("2026-12-08T08:00:00.000Z");
    expect(isExpired(record, new Date("2026-12-08T07:59:00.000Z"))).toBe(false);
    expect(isExpired(record, new Date("2026-12-08T08:00:00.000Z"))).toBe(true);
  });

  it("falls back to the default for an unknown retention value", () => {
    const store = storeWith(NOW.toISOString(), 3);
    expect(readActivity(store)?.retention_days).toBe(DEFAULT_RETENTION_DAYS);
  });
});
