import { useEffect, useMemo, useState } from "react";
import type { Client } from "@/types";
import {
  buildProspectRequest,
  fallbackReason,
  fetchProspectAnalysis,
  fingerprintRequest,
  isProspectAnalysisResponse,
  type ProspectAnalysisResponse,
} from "@/lib/prospectAnalysis";

export type ProspectAnalysisState =
  /** Request in flight and nothing cached for this data yet. */
  | { status: "loading" }
  /** Model result available. `updating` is true while a newer result is being fetched. */
  | { status: "ok"; result: ProspectAnalysisResponse; updating: boolean }
  /** Show the rule-based profile, with the reason. */
  | { status: "fallback"; reason: string; result?: ProspectAnalysisResponse };

const MEMORY_CACHE_SIZE = 3;
const memoryCache = new Map<string, ProspectAnalysisResponse>();
const SESSION_KEY_PREFIX = "clie_prospect_analysis:";

/**
 * Runs the Python prospect analysis for the current clients.
 *
 * Results are cached by a fingerprint of the contract data (in memory and in
 * sessionStorage), so moving between pages doesn't refetch, and a new request
 * is made only when an import changes the data. The analysis is deterministic
 * for given data, so a cached result is as good as a fresh one.
 */
export function useProspectAnalysis(clients: Client[]): ProspectAnalysisState {
  const request = useMemo(() => buildProspectRequest(clients), [clients]);
  const fingerprint = useMemo(() => fingerprintRequest(request), [request]);
  const [fetched, setFetched] = useState<{ fingerprint: string; state: ProspectAnalysisState } | null>(null);

  const cached = readCache(fingerprint);

  useEffect(() => {
    if (request.customers.length === 0 || readCache(fingerprint)) return;
    const controller = new AbortController();
    fetchProspectAnalysis(request, controller.signal)
      .then((result) => {
        writeCache(fingerprint, result);
        setFetched({ fingerprint, state: toState(result) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Prospect analysis unavailable:", error);
        setFetched({
          fingerprint,
          state: { status: "fallback", reason: "Analysis service unreachable. Showing the rule-based profile." },
        });
      });
    return () => controller.abort();
    // `request` changes whenever `fingerprint` does; keying on the fingerprint avoids refetching identical data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  if (request.customers.length === 0) {
    return { status: "fallback", reason: "Upload a Sales Report to run the analysis." };
  }
  if (cached) return toState(cached);
  if (fetched?.fingerprint === fingerprint) return fetched.state;
  // New data is being analysed: keep showing the previous model result, marked as updating.
  if (fetched?.state.status === "ok") return { ...fetched.state, updating: true };
  return { status: "loading" };
}

function toState(result: ProspectAnalysisResponse): ProspectAnalysisState {
  return result.status === "ok"
    ? { status: "ok", result, updating: false }
    : { status: "fallback", reason: fallbackReason(result), result };
}

function readCache(fingerprint: string): ProspectAnalysisResponse | undefined {
  const inMemory = memoryCache.get(fingerprint);
  if (inMemory) return inMemory;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_PREFIX + fingerprint);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isProspectAnalysisResponse(parsed)) return undefined;
    remember(fingerprint, parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function writeCache(fingerprint: string, result: ProspectAnalysisResponse) {
  remember(fingerprint, result);
  try {
    // Keep only the latest result in sessionStorage.
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(SESSION_KEY_PREFIX)) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(SESSION_KEY_PREFIX + fingerprint, JSON.stringify(result));
  } catch {
    // Best effort: storage can be full or blocked; the in-memory cache still works.
  }
}

function remember(fingerprint: string, result: ProspectAnalysisResponse) {
  memoryCache.delete(fingerprint);
  memoryCache.set(fingerprint, result);
  while (memoryCache.size > MEMORY_CACHE_SIZE) memoryCache.delete(memoryCache.keys().next().value!);
}
