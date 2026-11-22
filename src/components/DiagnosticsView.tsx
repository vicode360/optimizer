import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  Cpu,
  Info,
  MemoryStick,
  Monitor,
  Network,
  Rocket,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import type {
  DiagnosticFinding,
  DiagnosticSeverity,
  SystemScanReport,
  TelemetryTick,
} from "../types/system";
import {
  formatBytes,
  formatBytesPerSec,
  formatPercent,
  formatUptime,
} from "../utils/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";

interface DiagnosticsViewProps {
  report: SystemScanReport;
  telemetry: TelemetryTick | null;
  scanning: boolean;
  pendingRecommendedCount: number;
  onOpenTweaks: () => void;
  onQuickOptimize: () => void;
}

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
  optimal: 3,
};

function severityMeta(severity: DiagnosticSeverity) {
  switch (severity) {
    case "critical":
      return {
        label: "Crítico",
        badgeVariant: "advanced" as const,
        strip: "bg-chart-2",
        icon: AlertOctagon,
      };
    case "warning":
      return {
        label: "Atenção",
        badgeVariant: "moderate" as const,
        strip: "bg-chart-3",
        icon: AlertTriangle,
      };
    case "info":
      return {
        label: "Recomendação",
        badgeVariant: "default" as const,
        strip: "bg-main",
        icon: Info,
      };
    case "optimal":
      return {
        label: "Ótimo",
        badgeVariant: "safe" as const,
        strip: "bg-chart-4",
        icon: CheckCircle2,
      };
  }
}

export function DiagnosticsView({
  report,
  telemetry,
  scanning,
  pendingRecommendedCount,
  onOpenTweaks,
  onQuickOptimize,
}: DiagnosticsViewProps) {
  const { hardware, peripherals, diagnostics } = report;

  const sortedDiagnostics = [...diagnostics].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );

  const criticalCount = diagnostics.filter(
    (d) => d.severity === "critical"
  ).length;
  const warningCount = diagnostics.filter(
    (d) => d.severity === "warning"
  ).length;

  const cpuUsage = Math.max(
    0,
    Math.min(100, telemetry?.cpuUsagePercent ?? hardware.cpu.usagePercent)
  );
  const memUsed = telemetry?.memoryUsedBytes ?? hardware.memory.usedBytes;
  const memTotal = telemetry?.memoryTotalBytes ?? hardware.memory.totalBytes;
  const memPercent = Math.max(
    0,
    Math.min(
      100,
      telemetry?.memoryPercent ?? (memTotal > 0 ? (memUsed / memTotal) * 100 : 0)
    )
  );

  const primaryGpu = hardware.gpus[0];
  const primaryMonitor =
    peripherals.monitors.find((m) => m.isPrimary) ?? peripherals.monitors[0];

  const statusHeadline = scanning
    ? "Varredura ativa..."
    : criticalCount > 0
      ? `${criticalCount} gargalo(s) crítico(s)`
      : warningCount > 0
        ? `${warningCount} alerta(s) de desempenho`
        : "Sistema estável";

  const statusVariant = scanning
    ? "default"
    : criticalCount > 0
      ? "advanced"
      : warningCount > 0
        ? "moderate"
        : "safe";

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden py-0">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-border bg-main/20 px-5 py-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-heading text-lg font-bold tracking-tight">
                {hardware.os.hostname}
              </span>
              <Badge variant={statusVariant}>{statusHeadline}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/80">
              <span>
                {hardware.os.name} {hardware.os.version} ({hardware.os.arch})
              </span>
              <span className="inline-flex items-center gap-1.5 font-heading font-bold">
                <Zap className="size-3.5" aria-hidden="true" />
                <span>{hardware.powerPlan.name}</span>
              </span>
              <span className="nb-mono">
                Uptime:{" "}
                <strong>
                  {formatUptime(
                    telemetry?.uptimeSeconds ?? hardware.os.uptimeSeconds
                  )}
                </strong>
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="success"
            onClick={onQuickOptimize}
          >
            <Rocket className="size-4" aria-hidden="true" />
            <span>
              {pendingRecommendedCount > 0
                ? `Otimização rápida (${pendingRecommendedCount})`
                : "Abrir otimizações"}
            </span>
          </Button>
        </div>

        <div className="grid grid-cols-1 divide-y-2 divide-border md:grid-cols-2 lg:grid-cols-4 lg:divide-x-2 lg:divide-y-0">
          <div className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/75">
                <Cpu className="size-4" aria-hidden="true" />
                <span>CPU</span>
              </span>
              <span className="nb-mono text-xl font-bold">
                {formatPercent(cpuUsage)}
              </span>
            </div>
            <Progress
              value={cpuUsage}
              indicatorClassName={
                cpuUsage >= 85
                  ? "bg-chart-2"
                  : cpuUsage >= 65
                    ? "bg-chart-3"
                    : "bg-main"
              }
            />
            <div className="truncate text-xs font-bold">
              {hardware.cpu.brand}
            </div>
            <div className="nb-mono text-[11px] text-foreground/70">
              {hardware.cpu.physicalCores}C / {hardware.cpu.logicalCores}T
            </div>
          </div>

          <div className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/75">
                <MemoryStick className="size-4" aria-hidden="true" />
                <span>Memória RAM</span>
              </span>
              <span className="nb-mono text-xl font-bold">
                {formatPercent(memPercent)}
              </span>
            </div>
            <Progress
              value={memPercent}
              indicatorClassName={
                memPercent >= 85
                  ? "bg-chart-2"
                  : memPercent >= 70
                    ? "bg-chart-3"
                    : "bg-chart-4"
              }
            />
            <div className="nb-mono text-xs font-bold">
              {formatBytes(memUsed)} / {formatBytes(memTotal)}
            </div>
            <div className="nb-mono text-[11px] text-foreground/70">
              Livre: {formatBytes(Math.max(0, memTotal - memUsed))}
            </div>
          </div>

          <div className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/75">
                <Monitor className="size-4" aria-hidden="true" />
                <span>GPU e tela</span>
              </span>
              <span className="nb-mono text-lg font-bold">
                {primaryGpu && primaryGpu.vramBytes > 0
                  ? formatBytes(primaryGpu.vramBytes)
                  : primaryMonitor
                    ? `${primaryMonitor.refreshRateHz} Hz`
                    : "—"}
              </span>
            </div>
            <div className="truncate text-xs font-bold">
              {primaryGpu ? primaryGpu.name : "GPU não detectada"}
            </div>
            <div className="nb-mono flex items-center justify-between text-[11px] text-foreground/70">
              <span className="truncate">
                {primaryMonitor
                  ? `${primaryMonitor.width}×${primaryMonitor.height}`
                  : "Sem display"}
              </span>
              {primaryMonitor && (
                <Badge variant="neutral" className="nb-mono px-1.5 py-0 text-[10.5px]">
                  {primaryMonitor.refreshRateHz} Hz
                </Badge>
              )}
            </div>
          </div>

          <div className="space-y-2.5 p-4">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 font-heading text-xs font-bold uppercase text-foreground/75">
                <Network className="size-4" aria-hidden="true" />
                <span>Rede</span>
              </span>
              <Badge variant="neutral" className="nb-mono px-1.5 py-0 text-[10.5px]">
                {hardware.networks.length} NIC
              </Badge>
            </div>

            <div className="space-y-2 pt-0.5">
              <div className="flex items-center justify-between rounded-base border-2 border-border bg-background px-2.5 py-1.5 text-xs">
                <span className="nb-mono inline-flex items-center gap-1 font-bold">
                  <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                  RX
                </span>
                <span className="nb-mono font-bold">
                  {formatBytesPerSec(telemetry?.networkRxBytesPerSec ?? 0)}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-base border-2 border-border bg-background px-2.5 py-1.5 text-xs">
                <span className="nb-mono inline-flex items-center gap-1 font-bold">
                  <ArrowUpFromLine className="size-3.5" aria-hidden="true" />
                  TX
                </span>
                <span className="nb-mono font-bold">
                  {formatBytesPerSec(telemetry?.networkTxBytesPerSec ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <section aria-label="Achados do diagnóstico" className="space-y-3">
        <div>
          <h2 className="font-heading text-base font-bold">
            Análise do sistema
          </h2>
          <p className="text-xs text-foreground/70">
            {sortedDiagnostics.length} verificações concluídas com base na
            leitura real do Registro, energia e hardware
          </p>
        </div>

        <Card className="overflow-hidden py-0">
          <CardContent className="divide-y-2 divide-border px-0">
            {sortedDiagnostics.map((finding) => (
              <DiagnosticRow
                key={finding.id}
                finding={finding}
                onOpenTweaks={onOpenTweaks}
              />
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function DiagnosticRow({
  finding,
  onOpenTweaks,
}: {
  finding: DiagnosticFinding;
  onOpenTweaks: () => void;
}) {
  const meta = severityMeta(finding.severity);
  const Icon = meta.icon;

  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-base border-2 border-border text-main-foreground ${meta.strip}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-sm font-bold">{finding.title}</h3>
            <Badge variant={meta.badgeVariant}>{meta.label}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-foreground/80">
            {finding.detail}
          </p>

          {finding.recommendedTweakIds.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {finding.recommendedTweakIds.map((tweakId) => (
                <span
                  key={tweakId}
                  className="nb-mono rounded-base border-2 border-border bg-background px-2 py-0.5 text-[11px] font-bold"
                >
                  {tweakId}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {finding.recommendedTweakIds.length > 0 && (
        <Button
          type="button"
          variant="neutral"
          size="sm"
          className="shrink-0 self-start"
          onClick={onOpenTweaks}
        >
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <span>Ver tweaks</span>
        </Button>
      )}
    </div>
  );
}
