import { useEffect, useMemo, useState } from "react";
import { tauriClient } from "../services/tauriClient";
import type { TelemetryTick } from "../types/system";

const MAX_HISTORY_SAMPLES = 45;
const STREAM_STALE_MS = 5000;

export interface UseTelemetryResult {
  latest: TelemetryTick | null;
  history: TelemetryTick[];
  connected: boolean;
}

export function useTelemetry(): UseTelemetryResult {
  const [history, setHistory] = useState<TelemetryTick[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const resetStaleTimer = () => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(() => {
        if (active) setConnected(false);
      }, STREAM_STALE_MS);
    };

    void tauriClient
      .onTelemetryTick((tick) => {
        if (!active) return;
        setConnected(true);
        resetStaleTimer();
        setHistory((prev) => {
          const next = [...prev, tick];
          return next.length > MAX_HISTORY_SAMPLES
            ? next.slice(next.length - MAX_HISTORY_SAMPLES)
            : next;
        });
      })
      .then((fn) => {
        if (!active) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        if (active) setConnected(false);
      });

    return () => {
      active = false;
      if (staleTimer) clearTimeout(staleTimer);
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return useMemo(
    () => ({
      latest: history.length > 0 ? history[history.length - 1] : null,
      history,
      connected,
    }),
    [history, connected]
  );
}
