/**
 * Data retention for this browser.
 *
 * CLIE keeps only a working copy of data the company already holds (Sales
 * Reports and PAFs), so it can be strict: if the app isn't used for
 * `retention_days`, everything it stored on this computer is deleted. The
 * files can simply be uploaded again.
 *
 * The activity record lives in its own small key, separate from the app data,
 * so it can be checked before the data is loaded and survives a purge (it
 * holds no customer information).
 */

export const ACTIVITY_KEY = "clie_activity_v1";

export const RETENTION_OPTIONS = [7, 14, 30] as const;
export type RetentionDays = (typeof RETENTION_OPTIONS)[number];
/** Covers weekends and long holidays for a daily user, while clearing a forgotten laptop within two weeks. */
export const DEFAULT_RETENTION_DAYS: RetentionDays = 14;

/** Minutes without interaction before the privacy screen covers the app. Nothing is deleted. */
export const IDLE_SHIELD_MINUTES = 15;

/** Activity is recorded at most this often, to avoid writing storage on every click. */
export const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ActivityRecord {
  /** Last time someone used the app in this browser (ISO). */
  last_active: string;
  retention_days: RetentionDays;
  /** Set when data was purged, so the next screen can say so; cleared once shown. */
  purged_at?: string;
}

/** Minimal storage interface so the logic can be tested without a browser. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readActivity(store: KeyValueStore): ActivityRecord | null {
  try {
    const raw = store.getItem(ACTIVITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActivityRecord>;
    if (typeof parsed.last_active !== "string" || Number.isNaN(Date.parse(parsed.last_active))) return null;
    const retention = RETENTION_OPTIONS.includes(parsed.retention_days as RetentionDays)
      ? (parsed.retention_days as RetentionDays)
      : DEFAULT_RETENTION_DAYS;
    return { last_active: parsed.last_active, retention_days: retention, purged_at: parsed.purged_at };
  } catch {
    return null;
  }
}

export function writeActivity(store: KeyValueStore, record: ActivityRecord): void {
  try {
    store.setItem(ACTIVITY_KEY, JSON.stringify(record));
  } catch {
    // Storage full or blocked: retention still works on the next successful write.
  }
}

export function isExpired(record: ActivityRecord, now: Date): boolean {
  return now.getTime() - Date.parse(record.last_active) >= record.retention_days * DAY_MS;
}

/** When the data will be cleared if the app isn't used again. */
export function purgeDate(record: ActivityRecord): Date {
  return new Date(Date.parse(record.last_active) + record.retention_days * DAY_MS);
}

/**
 * Run on app start, before the data is loaded. Deletes the stored data when
 * the app hasn't been used within the retention period, then records "now"
 * as the latest activity. Returns whether data was purged.
 *
 * Browsers that have data but no activity record yet (data saved before this
 * feature existed) start their retention clock now rather than being purged.
 */
export function enforceRetentionOnStartup(store: KeyValueStore, purge: () => void, now: Date = new Date()): boolean {
  const record = readActivity(store);
  const expired = record !== null && isExpired(record, now);
  if (expired) purge();
  writeActivity(store, {
    last_active: now.toISOString(),
    retention_days: record?.retention_days ?? DEFAULT_RETENTION_DAYS,
    ...(expired ? { purged_at: now.toISOString() } : record?.purged_at ? { purged_at: record.purged_at } : {}),
  });
  return expired;
}

/** Records that the app is being used, at most once per ACTIVITY_WRITE_INTERVAL_MS. */
export function touchActivity(store: KeyValueStore, now: Date = new Date()): void {
  const record = readActivity(store);
  if (record && now.getTime() - Date.parse(record.last_active) < ACTIVITY_WRITE_INTERVAL_MS) return;
  writeActivity(store, {
    last_active: now.toISOString(),
    retention_days: record?.retention_days ?? DEFAULT_RETENTION_DAYS,
    ...(record?.purged_at ? { purged_at: record.purged_at } : {}),
  });
}
