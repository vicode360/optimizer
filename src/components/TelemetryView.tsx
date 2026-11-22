import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Cpu,
  MemoryStick,
} from "lucide-react";
import type { AppLocale, TelemetryTick } from "../types/system";
import {
  formatBytes,
  formatBytesPerSec,
  formatPercent,
  formatTimestamp,
  formatUptime,
} from "../utils/format";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

interface TelemetryViewProps {
  latest: TelemetryTick | null;
  history: TelemetryTick[];
  locale?: AppLocale;
}

export function TelemetryView({
  latest,
  history,
  locale = "pt",
}: TelemetryViewProps) {
  const isPt = locale === "pt";

  if (!latest) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
            <Activity className="size-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-heading text-base font-bold">
              {isPt
                ? "Aguardando amostras de telemetria"
                : "Waiting for telemetry samples"}
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-foreground/75">
              {isPt
                ? "O stream telemetry://tick é emitido automaticamente a 1 Hz pelo backend Rust dentro do runtime Tauri."
                : "The telemetry://tick stream is emitted automatically at 1 Hz by the Rust backend inside the Tauri runtime."}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const cpuSeries = history.map((sample) => sample.cpuUsagePercent);
  const memSeries = history.map((sample) => sample.memoryPercent);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden py-0">
        <div className="grid grid-cols-1 divide-y-2 divide-border sm:grid-cols-2 lg:grid-cols-4 lg:divide-x-2 lg:divide-y-0">
          <div className="p-4">
            <div className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/70">
              <Cpu className="size-4" aria-hidden="true" />
              <span>{isPt ? "CPU global" : "Global CPU"}</span>
            </div>
            <div className="nb-mono mt-2 text-2xl font-bold">
              {formatPercent(latest.cpuUsagePercent)}
            </div>
            <div className="nb-mono mt-1 text-[11px] text-foreground/70">
              {latest.cpuPerCorePercent.length}{" "}
              {isPt ? "threads monitoradas" : "threads monitored"}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/70">
              <MemoryStick className="size-4" aria-hidden="true" />
              <span>{isPt ? "Memória em uso" : "Memory in use"}</span>
            </div>
            <div className="nb-mono mt-2 text-2xl font-bold">
              {formatPercent(latest.memoryPercent)}
            </div>
            <div className="nb-mono mt-1 text-[11px] text-foreground/70">
              {formatBytes(latest.memoryUsedBytes)} /{" "}
              {formatBytes(latest.memoryTotalBytes)}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/70">
              <ArrowDownToLine className="size-4" aria-hidden="true" />
              <span>Download (RX)</span>
            </div>
            <div className="nb-mono mt-2 text-2xl font-bold">
              {formatBytesPerSec(latest.networkRxBytesPerSec)}
            </div>
            <div className="mt-1 text-[11px] text-foreground/70">
              {isPt
                ? "Soma das interfaces ativas"
                : "Sum across active interfaces"}
            </div>
          </div>

          <div className="p-4">
            <div className="flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/70">
              <ArrowUpFromLine className="size-4" aria-hidden="true" />
              <span>Upload (TX) & Kernel Timer</span>
            </div>
            <div className="nb-mono mt-2 text-2xl font-bold">
              {formatBytesPerSec(latest.networkTxBytesPerSec)}
            </div>
            <div className="nb-mono mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-foreground/70">
              <span>Uptime: {formatUptime(latest.uptimeSeconds)}</span>
              {latest.timerResolutionMs !== undefined && (
                <Badge
                  variant={latest.timerResolutionMs <= 1.05 ? "safe" : "neutral"}
                  className="nb-mono px-1.5 py-0 text-[10px]"
                >
                  Timer: {latest.timerResolutionMs.toFixed(2)} ms
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TelemetryChartCard
          title={isPt ? "Histórico de CPU" : "CPU History"}
          currentValue={latest.cpuUsagePercent}
          values={cpuSeries}
          stroke="var(--chart-1)"
          fill="color-mix(in srgb, var(--chart-1) 24%, transparent)"
          badgeVariant="default"
          sampleCount={history.length}
          locale={locale}
        />

        <TelemetryChartCard
          title={isPt ? "Histórico de memória RAM" : "RAM Memory History"}
          currentValue={latest.memoryPercent}
          values={memSeries}
          stroke="var(--chart-4)"
          fill="color-mix(in srgb, var(--chart-4) 24%, transparent)"
          badgeVariant="safe"
          sampleCount={history.length}
          locale={locale}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {isPt
                ? "Distribuição por núcleo lógico"
                : "Per-Logical-Core Distribution"}
            </CardTitle>
            <p className="mt-0.5 text-xs text-foreground/70">
              {isPt ? "Atualização contínua via " : "Live updates via "}
              <code className="nb-mono font-bold">telemetry://tick</code>
            </p>
          </div>
          <Badge variant="neutral" className="nb-mono">
            {formatTimestamp(latest.timestamp, locale)}
          </Badge>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {latest.cpuPerCorePercent.map((usage, index) => {
              const clamped = Math.min(100, Math.max(0, usage));
              return (
                <div
                  key={index}
                  className="rounded-base border-2 border-border bg-background p-2.5"
                >
                  <div className="nb-mono mb-1.5 flex items-center justify-between text-xs font-bold">
                    <span className="text-foreground/70">T{index}</span>
                    <span>{Math.round(clamped)}%</span>
                  </div>
                  <Progress
                    value={clamped}
                    className="h-2.5"
                    indicatorClassName={
                      clamped >= 85
                        ? "bg-chart-2"
                        : clamped >= 65
                          ? "bg-chart-3"
                          : "bg-main"
                    }
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TelemetryChartCard({
  title,
  currentValue,
  values,
  stroke,
  fill,
  badgeVariant,
  sampleCount,
  locale,
}: {
  title: string;
  currentValue: number;
  values: number[];
  stroke: string;
  fill: string;
  badgeVariant: "default" | "safe";
  sampleCount: number;
  locale: AppLocale;
}) {
  const width = 480;
  const height = 140;
  const maxSamples = 45;
  const clampedCurrent = Math.max(0, Math.min(100, currentValue));

  const points = values.map((val, idx) => {
    const clamped = Math.max(0, Math.min(100, val));
    const offset = maxSamples - values.length + idx;
    const x = (offset / (maxSamples - 1)) * width;
    const y = height - (clamped / 100) * (height - 12) - 6;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyline = points.join(" ");
  const firstX =
    values.length > 0
      ? (((maxSamples - values.length) / (maxSamples - 1)) * width).toFixed(1)
      : "0";
  const areaPath =
    points.length > 1
      ? `M ${firstX},${height} L ${points.join(" L ")} L ${width},${height} Z`
      : "";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          <p className="mt-0.5 text-xs text-foreground/70">
            {locale === "pt"
              ? `Janela de ${sampleCount}s (máx. 45s)`
              : `${sampleCount}s window (max 45s)`}
          </p>
        </div>
        <Badge variant={badgeVariant} className="nb-mono text-sm">
          {formatPercent(clampedCurrent)}
        </Badge>
      </CardHeader>

      <CardContent>
        <div className="overflow-hidden rounded-base border-2 border-border bg-background p-2">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-36 w-full"
            role="img"
            aria-label={`${title}: ${formatPercent(clampedCurrent)}`}
          >
            {[25, 50, 75].map((pct) => {
              const y = height - (pct / 100) * (height - 12) - 6;
              return (
                <line
                  key={pct}
                  x1="0"
                  y1={y}
                  x2={width}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.18"
                  strokeDasharray="4 4"
                  strokeWidth="1"
                />
              );
            })}

            {areaPath && <path d={areaPath} fill={fill} />}
            {points.length > 1 && (
              <polyline
                fill="none"
                stroke={stroke}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={polyline}
              />
            )}
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}
