import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeAppError, tauriClient } from "../services/tauriClient";
import type {
  AppError,
  ApplyTweaksResult,
  RevertSessionResult,
  TweakItem,
  TweakProgressEvent,
} from "../types/system";

interface UseTweaksOptions {
  onMutationComplete?: () => Promise<void> | void;
}

interface RefreshOptions {
  preserveError?: boolean;
}

export interface UseTweaksResult {
  items: TweakItem[];
  selectedIds: string[];
  sessionLabel: string;
  loading: boolean;
  busy: boolean;
  progress: TweakProgressEvent | null;
  lastApplyResult: ApplyTweaksResult | null;
  lastRevertResult: RevertSessionResult | null;
  error: AppError | null;
  refresh: (opts?: RefreshOptions) => Promise<void>;
  toggleSelect: (id: string) => void;
  setSelected: (ids: string[]) => void;
  setSessionLabel: (label: string) => void;
  clearSelection: () => void;
  applySelected: (sessionLabel?: string) => Promise<ApplyTweaksResult | null>;
  revertSession: (sessionId: string) => Promise<RevertSessionResult | null>;
  revertAllSessions: (
    sessionIds: string[]
  ) => Promise<RevertSessionResult | null>;
}

export function useTweaks(options?: UseTweaksOptions): UseTweaksResult {
  const [items, setItems] = useState<TweakItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sessionLabel, setSessionLabelState] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<TweakProgressEvent | null>(null);
  const [lastApplyResult, setLastApplyResult] =
    useState<ApplyTweaksResult | null>(null);
  const [lastRevertResult, setLastRevertResult] =
    useState<RevertSessionResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const busyRef = useRef(false);
  const refreshReqIdRef = useRef(0);
  const selectedIdsRef = useRef<string[]>(selectedIds);
  selectedIdsRef.current = selectedIds;

  const onMutationCompleteRef = useRef(options?.onMutationComplete);
  onMutationCompleteRef.current = options?.onMutationComplete;

  const refresh = useCallback(async (opts?: RefreshOptions) => {
    const reqId = ++refreshReqIdRef.current;
    setLoading(true);
    if (!opts?.preserveError) {
      setError(null);
    }
    try {
      const list = await tauriClient.listTweaks();
      if (reqId !== refreshReqIdRef.current) return;
      setItems(list);
      const applicableIds = new Set(
        list.filter((item) => item.applicable).map((item) => item.id)
      );
      setSelectedIds((prev) => prev.filter((id) => applicableIds.has(id)));
    } catch (err) {
      if (reqId !== refreshReqIdRef.current) return;
      if (!opts?.preserveError) {
        setError(normalizeAppError(err));
      }
    } finally {
      if (reqId === refreshReqIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      refreshReqIdRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void tauriClient
      .onTweakProgress((evt) => {
        if (!active) return;
        setProgress(evt);
      })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Ignore event subscription errors in non-Tauri test environments.
      });

    return () => {
      active = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const toggleSelect = useCallback((id: string) => {
    if (busyRef.current) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const setSelected = useCallback((ids: string[]) => {
    if (busyRef.current) return;
    setSelectedIds(Array.from(new Set(ids)));
  }, []);

  const setSessionLabel = useCallback((label: string) => {
    if (busyRef.current) return;
    setSessionLabelState(label);
  }, []);

  const clearSelection = useCallback(() => {
    if (busyRef.current) return;
    setSelectedIds([]);
    setSessionLabelState("");
  }, []);

  const applySelected = useCallback(
    async (overrideLabel?: string) => {
      const ids = selectedIdsRef.current;
      if (ids.length === 0 || busyRef.current) return null;

      busyRef.current = true;
      setBusy(true);
      setError(null);
      setLastApplyResult(null);
      setLastRevertResult(null);
      setProgress(null);

      try {
        const result = await tauriClient.applyTweaks(ids, overrideLabel);
        setLastApplyResult(result);
        const failedIds = new Set(result.failures.map((f) => f.tweakId));
        setSelectedIds((prev) => prev.filter((id) => failedIds.has(id)));
        if (result.failures.length === 0) {
          setSessionLabelState("");
        }
        await refresh();
        if (onMutationCompleteRef.current) {
          await onMutationCompleteRef.current();
        }
        return result;
      } catch (err) {
        setError(normalizeAppError(err));
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh]
  );

  const revertSession = useCallback(
    async (sessionId: string) => {
      if (busyRef.current) return null;

      busyRef.current = true;
      setBusy(true);
      setError(null);
      setLastApplyResult(null);
      setLastRevertResult(null);
      setProgress(null);

      try {
        const result = await tauriClient.revertBackupSession(sessionId);
        setLastRevertResult(result);
        await refresh();
        if (onMutationCompleteRef.current) {
          await onMutationCompleteRef.current();
        }
        return result;
      } catch (err) {
        setError(normalizeAppError(err));
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh]
  );

  const revertAllSessions = useCallback(
    async (sessionIds: string[]) => {
      if (sessionIds.length === 0 || busyRef.current) return null;

      busyRef.current = true;
      setBusy(true);
      setError(null);
      setLastApplyResult(null);
      setLastRevertResult(null);
      setProgress(null);

      let totalReverted = 0;
      let attemptedCount = 0;
      const allFailures: RevertSessionResult["failures"] = [];
      let allRestored = true;
      let lastId = sessionIds[0];

      try {
        for (const sessionId of sessionIds) {
          lastId = sessionId;
          attemptedCount += 1;
          const result = await tauriClient.revertBackupSession(sessionId);
          totalReverted += result.revertedCount;
          allFailures.push(...result.failures);
          if (!result.markedRestored || result.failures.length > 0) {
            allRestored = false;
            break;
          }
        }

        const summaryId =
          sessionIds.length === 1
            ? lastId
            : attemptedCount < sessionIds.length
              ? `${attemptedCount}/${sessionIds.length} sessões (interrompido)`
              : `${sessionIds.length} sessões`;

        const aggregated: RevertSessionResult = {
          sessionId: summaryId,
          revertedCount: totalReverted,
          failures: allFailures,
          markedRestored: allRestored,
        };
        setLastRevertResult(aggregated);
        await refresh();
        if (onMutationCompleteRef.current) {
          await onMutationCompleteRef.current();
        }
        return aggregated;
      } catch (err) {
        setError(normalizeAppError(err));
        if (totalReverted > 0) {
          setLastRevertResult({
            sessionId: `${attemptedCount}/${sessionIds.length} sessões (interrompido)`,
            revertedCount: totalReverted,
            failures: allFailures,
            markedRestored: false,
          });
        }
        await refresh({ preserveError: true });
        if (onMutationCompleteRef.current) {
          await onMutationCompleteRef.current();
        }
        return null;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [refresh]
  );

  return useMemo(
    () => ({
      items,
      selectedIds,
      sessionLabel,
      loading,
      busy,
      progress,
      lastApplyResult,
      lastRevertResult,
      error,
      refresh,
      toggleSelect,
      setSelected,
      setSessionLabel,
      clearSelection,
      applySelected,
      revertSession,
      revertAllSessions,
    }),
    [
      items,
      selectedIds,
      sessionLabel,
      loading,
      busy,
      progress,
      lastApplyResult,
      lastRevertResult,
      error,
      refresh,
      toggleSelect,
      setSelected,
      setSessionLabel,
      clearSelection,
      applySelected,
      revertSession,
      revertAllSessions,
    ]
  );
}
