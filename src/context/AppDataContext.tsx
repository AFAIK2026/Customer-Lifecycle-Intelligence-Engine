import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AppData, Client, ClientProfile, Notification } from "@/types";
import { clearStoredData, loadData, resetData, saveData } from "@/lib/storage";
import {
  enforceRetentionOnStartup,
  isExpired,
  readActivity,
  touchActivity,
  writeActivity,
  DEFAULT_RETENTION_DAYS,
  type ActivityRecord,
  type RetentionDays,
} from "@/lib/retention";
import { parseSalesReport } from "@/lib/salesReport";
import { applyImport, removeImport as removeImportFromData } from "@/lib/imports";
import { buildDocStatus, detectNewMilestones } from "@/lib/milestones";
import { sendMilestoneAlerts } from "@/lib/email";
import { aliasLabel } from "@/lib/customerAliases";
import { parsePafWorkbook, type PafParseResult, type WorkbookSheet } from "@/lib/paf";
import { applyPafImport, createProfileLookup, removePafImport as removePafImportFromData, type PafRowMatch } from "@/lib/pafImports";

export interface ImportFileResult {
  fileName: string;
  customersProcessed: number;
  newNotifications: Notification[];
}

export interface ImportPafResult extends Omit<PafParseResult, "rows"> {
  fileName: string;
  rowCount: number;
  matches: PafRowMatch[];
}

interface AppDataContextValue {
  data: AppData;
  /** Parses and applies a Sales Report, recording it as an import. Throws on invalid files or full storage. */
  importFile: (fileName: string, text: string) => ImportFileResult;
  /** Removes an import and rebuilds payment data without it. */
  removeImport: (importId: string) => void;
  /** Parses and applies a PAF workbook, recording it as an import. Throws on invalid workbooks or full storage. */
  importPafWorkbook: (fileName: string, sheets: WorkbookSheet[]) => ImportPafResult;
  /** Removes a PAF import and rebuilds client profiles without it. */
  removePafImport: (importId: string) => void;
  /** The client's Purchase Application Form details, if any were uploaded. */
  profileFor: (client: Client) => ClientProfile | undefined;
  /** Current retention setting and activity for this browser. */
  retention: ActivityRecord;
  setRetentionDays: (days: RetentionDays) => void;
  /** Deletes all CLIE data stored in this browser. */
  clearAllData: () => void;
  /** Hides the "data was cleared" notice. */
  dismissPurgeNotice: () => void;
  setAlertEmail: (email: string) => void;
  setHideCustomerNames: (hide: boolean) => void;
  /** The name to show for a customer: "Customer N" while names are hidden, the real name otherwise. */
  displayName: (name: string) => string;
  updateClientDocuments: (clientId: string, submittedDocs: string[]) => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  // Retention runs before the data is loaded, so expired data is never read into memory.
  const [data, setData] = useState<AppData>(() => {
    enforceRetentionOnStartup(localStorage, clearStoredData);
    return loadData();
  });
  const [retention, setRetention] = useState<ActivityRecord>(() => currentActivity());
  // Latest data, updated synchronously by importFile so several files imported
  // back-to-back each build on the previous one rather than a stale render.
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    saveData(data);
  }, [data]);

  // Record use of the app (throttled), and purge if the tab is left open but unused past the retention period.
  useEffect(() => {
    const onActivity = () => touchActivity(localStorage);
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true });

    const check = window.setInterval(() => {
      const record = readActivity(localStorage);
      if (record && isExpired(record, new Date())) {
        const purgedAt = new Date().toISOString();
        const fresh = resetData();
        writeActivity(localStorage, { ...record, last_active: purgedAt, purged_at: purgedAt });
        dataRef.current = fresh;
        setData(fresh);
        setRetention(currentActivity());
      }
    }, 60 * 60 * 1000);

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      window.clearInterval(check);
    };
  }, []);

  function setRetentionDays(days: RetentionDays) {
    const record = currentActivity();
    writeActivity(localStorage, { ...record, retention_days: days, last_active: new Date().toISOString() });
    setRetention(currentActivity());
  }

  function clearAllData() {
    const fresh = resetData();
    dataRef.current = fresh;
    setData(fresh);
  }

  function dismissPurgeNotice() {
    const { purged_at: _cleared, ...rest } = currentActivity();
    writeActivity(localStorage, rest);
    setRetention(currentActivity());
  }

  function importFile(fileName: string, text: string): ImportFileResult {
    const rows = parseSalesReport(text);
    const result = applyImport(dataRef.current, { fileName, rows });

    // Save up front so a full browser storage is reported as an import error
    // instead of failing silently in the persistence effect.
    saveData(result.data);
    dataRef.current = result.data;
    setData(result.data);

    if (result.newNotifications.length > 0) {
      sendMilestoneAlerts(result.newNotifications).then((sent) => {
        setData((prev) => ({
          ...prev,
          notifications: prev.notifications.map((n) => sent.find((s) => s.id === n.id) ?? n),
        }));
      });
    }

    return { fileName, customersProcessed: result.customersProcessed, newNotifications: result.newNotifications };
  }

  function removeImport(importId: string) {
    setData((prev) => removeImportFromData(prev, importId));
  }

  function importPafWorkbook(fileName: string, sheets: WorkbookSheet[]): ImportPafResult {
    const { rows, ...parse } = parsePafWorkbook(sheets);
    if (rows.length === 0) throw new Error("No customer rows found on the Customer Details sheet");
    const result = applyPafImport(dataRef.current, { fileName, rows });

    // Save up front so a full browser storage is reported as an import error.
    saveData(result.data);
    dataRef.current = result.data;
    setData(result.data);
    return { ...parse, fileName, rowCount: rows.length, matches: result.matches };
  }

  function removePafImport(importId: string) {
    setData((prev) => removePafImportFromData(prev, importId));
  }

  const profileFor = useMemo(() => createProfileLookup(data), [data]);

  function setAlertEmail(email: string) {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, alert_email: email } }));
  }

  function setHideCustomerNames(hide: boolean) {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, hide_customer_names: hide } }));
  }

  function displayName(name: string): string {
    return data.settings.hide_customer_names ? aliasLabel(data.customer_aliases, name) : name;
  }

  function updateClientDocuments(clientId: string, submittedDocs: string[]) {
    const client = data.clients.find((c) => c.id === clientId);
    if (!client) throw new Error(`Client ${clientId} not found`);

    const documentation_status = buildDocStatus(submittedDocs);
    const today = new Date().toISOString();
    const newlyCrossed = detectNewMilestones(client.milestones_reached, client.payment_percentage, documentation_status);

    const updatedClients = data.clients.map((c) =>
      c.id === clientId
        ? { ...c, documentation_status, milestones_reached: [...new Set([...c.milestones_reached, ...newlyCrossed])] }
        : c
    );

    const newNotifications: Notification[] = newlyCrossed.map((milestone) => ({
      id: crypto.randomUUID(),
      client_id: client.id,
      client_name: client.name,
      milestone,
      payment_percentage: client.payment_percentage,
      timestamp: today,
      email_sent: false,
      sent_to: data.settings.alert_email,
      kind: "milestone" as const,
    }));

    setData((prev) => ({
      ...prev,
      clients: updatedClients,
      notifications: [...newNotifications, ...prev.notifications],
    }));

    if (newNotifications.length > 0) {
      sendMilestoneAlerts(newNotifications).then((sent) => {
        setData((prev) => ({
          ...prev,
          notifications: prev.notifications.map((n) => sent.find((s) => s.id === n.id) ?? n),
        }));
      });
    }
  }

  return (
    <AppDataContext.Provider value={{ data, importFile, removeImport, importPafWorkbook, removePafImport, profileFor, retention, setRetentionDays, clearAllData, dismissPurgeNotice, setAlertEmail, setHideCustomerNames, displayName, updateClientDocuments }}>
      {children}
    </AppDataContext.Provider>
  );
}

function currentActivity(): ActivityRecord {
  return readActivity(localStorage) ?? { last_active: new Date().toISOString(), retention_days: DEFAULT_RETENTION_DAYS };
}

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
