import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { tauriClient, normalizeAppError } from "../services/tauriClient";
import type { AppError, SystemScanReport } from "../types/system";

export interface UseSystemScanResult {
  report: SystemScanReport | null;
  scanning: boolean;
  error: AppError | null;
  runScan: () => Promise<void>;
}

export function useSystemScan(): UseSystemScanResult {
  const [report, setReport] = useState<SystemScanReport | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const reqIdRef = useRef(0);

  const runScan = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setScanning(true);
    setError(null);
    try {
      const result = await tauriClient.runSystemScan();
      if (reqId !== reqIdRef.current) return;
      setReport(result);
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(normalizeAppError(err));
    } finally {
      if (reqId === reqIdRef.current) {
        setScanning(false);
      }
    }
  }, []);

  useEffect(() => {
    void runScan();
    return () => {
      reqIdRef.current += 1;
    };
  }, [runScan]);

  return useMemo(
    () => ({ report, scanning, error, runScan }),
    [report, scanning, error, runScan]
  );
}
