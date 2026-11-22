import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriClient, normalizeAppError } from "../services/tauriClient";
import type { AppError, PrivilegeStatus } from "../types/system";

export interface UsePrivilegeStatusResult {
  privilege: PrivilegeStatus | null;
  loading: boolean;
  error: AppError | null;
  refresh: () => Promise<void>;
}

export function usePrivilegeStatus(): UsePrivilegeStatusResult {
  const [privilege, setPrivilege] = useState<PrivilegeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const reqIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const status = await tauriClient.getPrivilegeStatus();
      if (reqId !== reqIdRef.current) return;
      setPrivilege(status);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(normalizeAppError(err));
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      reqIdRef.current += 1;
    };
  }, [refresh]);

  return useMemo(
    () => ({ privilege, loading, error, refresh }),
    [privilege, loading, error, refresh]
  );
}
