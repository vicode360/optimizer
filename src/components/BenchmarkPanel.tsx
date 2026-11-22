import { useState } from "react";
import { Gauge, Play, RotateCcw } from "lucide-react";
import { UI_COPY } from "../i18n";
import { normalizeAppError, tauriClient } from "../services/tauriClient";
import type { AppError, AppLocale, BenchmarkSnapshot } from "../types/system";
import { formatBytes, formatTimestamp } from "../utils/format";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const BASELINE_STORAGE_KEY = "optimizer-benchmark-baseline";

function loadSavedBaseline(): BenchmarkSnapshot | null {
  try {
    const raw = window.localStorage.getItem(BASELINE_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BenchmarkSnapshot;
  } catch {
    return null;
  }
}

interface BenchmarkPanelProps {
  locale: AppLocale;
}

export function BenchmarkPanel({ locale }: BenchmarkPanelProps) {
  const copy = UI_COPY[locale].benchmark;
  const [baseline, setBaseline] = useState<BenchmarkSnapshot | null>(
    loadSavedBaseline
  );
  const [current, setCurrent] = useState<BenchmarkSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const handleCaptureBaseline = async () => {
    setRunning(true);
    setError(null);
    try {
      const snap = await tauriClient.runSystemBenchmark();
      setBaseline(snap);
      try {
        window.localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(snap));
      } catch {
        // Ignore localStorage quota issues.
      }
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setRunning(false);
    }
  };

  const handleCaptureComparison = async () => {
    setRunning(true);
    setError(null);
    try {
      const snap = await tauriClient.runSystemBenchmark();
      if (!baseline) {
        setBaseline(snap);
      } else {
        setCurrent(snap);
      }
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    setBaseline(null);
    setCurrent(null);
    setError(null);
    try {
      window.localStorage.removeItem(BASELINE_STORAGE_KEY);
    } catch {
      // Ignore storage errors.
    }
  };

  const formatMsDelta = (beforeVal: number | null, afterVal: number | null) => {
    if (beforeVal === null || afterVal === null) return null;
    const diff = afterVal - beforeVal;
    const sign = diff > 0 ? "+" : "";
    const improved = diff <= 0;
    return {
      text: `${sign}${diff.toFixed(2)} ms`,
      variant: improved ? ("safe" as const) : ("moderate" as const),
    };
  };

  const formatRamDelta = (beforeBytes: number, afterBytes: number) => {
    const diff = afterBytes - beforeBytes;
    const sign = diff >= 0 ? "+" : "-";
    return {
      text: `${sign}${formatBytes(Math.abs(diff))}`,
      variant: diff >= 0 ? ("safe" as const) : ("neutral" as const),
    };
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-chart-3 text-main-foreground">
            <Gauge className="size-4" aria-hidden="true" />
          </div>
          <div>
            <CardTitle className="text-base">{copy.title}</CardTitle>
            <p className="mt-0.5 text-xs text-foreground/75">{copy.subtitle}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => void handleCaptureBaseline()}
            disabled={running}
          >
            <Play className="size-3.5" aria-hidden="true" />
            <span>{running ? copy.running : copy.captureBaseline}</span>
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void handleCaptureComparison()}
            disabled={running}
          >
            <Gauge className="size-3.5" aria-hidden="true" />
            <span>{running ? copy.running : copy.captureComparison}</span>
          </Button>

          {(baseline || current) && (
            <Button
              type="button"
              variant="neutral"
              size="xs"
              onClick={handleClear}
              disabled={running}
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>{copy.clearBaseline}</span>
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>[{error.code}]</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {!baseline ? (
          <div className="rounded-base border-2 border-border bg-background p-4 text-xs text-foreground/80">
            {copy.emptyHint}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-base border-2 border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b-2 border-border bg-background font-heading font-bold">
                  <th className="px-4 py-2.5">{copy.metric}</th>
                  <th className="px-4 py-2.5">
                    {copy.before}{" "}
                    <span className="nb-mono font-normal text-foreground/65">
                      ({formatTimestamp(baseline.capturedAt, locale)})
                    </span>
                  </th>
                  <th className="px-4 py-2.5">
                    {copy.after}{" "}
                    {current && (
                      <span className="nb-mono font-normal text-foreground/65">
                        ({formatTimestamp(current.capturedAt, locale)})
                      </span>
                    )}
                  </th>
                  <th className="px-4 py-2.5 text-right">{copy.delta}</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-border bg-secondary-background">
                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.timerAvg}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {baseline.timerAvgMs.toFixed(2)} ms
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current ? `${current.timerAvgMs.toFixed(2)} ms` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current ? (
                      <DeltaBadge
                        delta={formatMsDelta(
                          baseline.timerAvgMs,
                          current.timerAvgMs
                        )}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.timerP95}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {baseline.timerP95Ms.toFixed(2)} ms
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current ? `${current.timerP95Ms.toFixed(2)} ms` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current ? (
                      <DeltaBadge
                        delta={formatMsDelta(
                          baseline.timerP95Ms,
                          current.timerP95Ms
                        )}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.timerJitter}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {baseline.timerJitterMs.toFixed(2)} ms
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current ? `${current.timerJitterMs.toFixed(2)} ms` : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current ? (
                      <DeltaBadge
                        delta={formatMsDelta(
                          baseline.timerJitterMs,
                          current.timerJitterMs
                        )}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.dnsLatency}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {baseline.dnsLatencyMs !== null
                      ? `${baseline.dnsLatencyMs.toFixed(2)} ms (${baseline.primaryDnsServer})`
                      : "Offline"}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current
                      ? current.dnsLatencyMs !== null
                        ? `${current.dnsLatencyMs.toFixed(2)} ms (${current.primaryDnsServer})`
                        : "Offline"
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current &&
                    baseline.dnsLatencyMs !== null &&
                    current.dnsLatencyMs !== null ? (
                      <DeltaBadge
                        delta={formatMsDelta(
                          baseline.dnsLatencyMs,
                          current.dnsLatencyMs
                        )}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.freeRam}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {formatBytes(baseline.memoryAvailableBytes)}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current
                      ? formatBytes(current.memoryAvailableBytes)
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current ? (
                      <DeltaBadge
                        delta={formatRamDelta(
                          baseline.memoryAvailableBytes,
                          current.memoryAvailableBytes
                        )}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.powerPlan}
                  </td>
                  <td className="px-4 py-2.5 font-bold">
                    {baseline.powerPlanName}
                  </td>
                  <td className="px-4 py-2.5 font-bold">
                    {current ? current.powerPlanName : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current &&
                    current.powerPlanName !== baseline.powerPlanName ? (
                      <Badge variant="safe">
                        {locale === "pt" ? "Atualizado" : "Updated"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>

                <tr>
                  <td className="px-4 py-2.5 font-heading font-bold">
                    {copy.tcpStack}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {baseline.tcpCongestionProvider} / RSC={baseline.tcpRsc}
                  </td>
                  <td className="nb-mono px-4 py-2.5">
                    {current
                      ? `${current.tcpCongestionProvider} / RSC=${current.tcpRsc}`
                      : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {current &&
                    (current.tcpCongestionProvider !==
                      baseline.tcpCongestionProvider ||
                      current.tcpRsc !== baseline.tcpRsc) ? (
                      <Badge variant="safe">
                        {locale === "pt" ? "Otimizado" : "Optimized"}
                      </Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeltaBadge({
  delta,
}: {
  delta: { text: string; variant: "safe" | "moderate" | "neutral" } | null;
}) {
  if (!delta) return <span>—</span>;
  return (
    <Badge variant={delta.variant} className="nb-mono">
      {delta.text}
    </Badge>
  );
}
