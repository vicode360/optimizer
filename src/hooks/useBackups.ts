import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriClient, normalizeAppError } from "../services/tauriClient";
import type {
  AppError,
  BackupSession,
  BackupSessionSummary,
} from "../types/system";

export interface UseBackupsResult {
  directory: string | null;
  sessions: BackupSessionSummary[];
  selectedSession: BackupSession | null;
  loading: boolean;
  loadingSession: boolean;
  error: AppError | null;
  refresh: () => Promise<void>;
  inspectSession: (sessionId: string) => Promise<void>;
}

export function useBackups(): UseBackupsResult {
  const [directory, setDirectory] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BackupSessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<BackupSession | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [loadingSession, setLoadingSession] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const refreshReqIdRef = useRef(0);
  const inspectReqIdRef = useRef(0);
  const selectedSessionIdRef = useRef<string | null>(null);

  const inspectSession = useCallback(async (sessionId: string) => {
    selectedSessionIdRef.current = sessionId;
    const reqId = ++inspectReqIdRef.current;
    setLoadingSession(true);
    setError(null);
    try {
      const session = await tauriClient.getBackupSession(sessionId);
      if (reqId !== inspectReqIdRef.current) return;
      setSelectedSession(session);
    } catch (err) {
      if (reqId !== inspectReqIdRef.current) return;
      setError(normalizeAppError(err));
    } finally {
      if (reqId === inspectReqIdRef.current) {
        setLoadingSession(false);
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    const reqId = ++refreshReqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const [dir, list] = await Promise.all([
        tauriClient.getBackupDirectory(),
        tauriClient.listBackups(),
      ]);
      if (reqId !== refreshReqIdRef.current) return;
      setDirectory(dir);
      setSessions(list);

      const currentSelectedId = selectedSessionIdRef.current;
      if (currentSelectedId) {
        const stillExists = list.some((s) => s.sessionId === currentSelectedId);
        if (stillExists) {
          const inspectReq = ++inspectReqIdRef.current;
          try {
            const refreshed =
              await tauriClient.getBackupSession(currentSelectedId);
            if (inspectReq === inspectReqIdRef.current) {
              setSelectedSession(refreshed);
            }
          } catch {
            // Keep list refreshed even if individual session inspection fails.
          }
        } else {
          selectedSessionIdRef.current = null;
          setSelectedSession(null);
        }
      }
    } catch (err) {
      if (reqId !== refreshReqIdRef.current) return;
      setError(normalizeAppError(err));
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
      inspectReqIdRef.current += 1;
    };
  }, [refresh]);

  return useMemo(
    () => ({
      directory,
      sessions,
      selectedSession,
      loading,
      loadingSession,
      error,
      refresh,
      inspectSession,
    }),
    [
      directory,
      sessions,
      selectedSession,
      loading,
      loadingSession,
      error,
      refresh,
      inspectSession,
    ]
  );
}
