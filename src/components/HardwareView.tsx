import { memo } from "react";
import {
  Cpu,
  HardDrive,
  Keyboard,
  Monitor,
  Mouse,
  Network,
  Radar,
  Server,
} from "lucide-react";
import type { AppLocale, SystemScanReport } from "../types/system";
import {
  formatBytes,
  formatFrequencyMhz,
  formatPercent,
  formatTimestamp,
  formatUptime,
} from "../utils/format";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

interface HardwareViewProps {
  report: SystemScanReport;
  scanning: boolean;
  locale?: AppLocale;
}

export const HardwareView = memo(function HardwareView({
  report,
  scanning,
  locale = "pt",
}: HardwareViewProps) {
  const isPt = locale === "pt";
  const { hardware, peripherals } = report;
  const memPercent =
    hardware.memory.totalBytes > 0
      ? (hardware.memory.usedBytes / hardware.memory.totalBytes) * 100
      : 0;
  const swapPercent =
    hardware.memory.swapTotalBytes > 0
      ? (hardware.memory.swapUsedBytes / hardware.memory.swapTotalBytes) * 100
      : 0;

  const totalPeripherals =
    peripherals.monitors.length +
    peripherals.mice.length +
    peripherals.keyboards.length;

  const scannerHeadline = scanning
    ? isPt
      ? "Varredura ativa: WMI, sysinfo e Win32 GDI..."
      : "Active scan: WMI, sysinfo, and Win32 GDI..."
    : isPt
      ? `Inventário concluído — ${hardware.gpus.length} GPU, ${hardware.disks.length} discos, ${totalPeripherals} periféricos`
      : `Inventory completed — ${hardware.gpus.length} GPU, ${hardware.disks.length} disks, ${totalPeripherals} peripherals`;

  return (
    <div className="space-y-5">
      <Card className="py-3.5">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={`flex size-8 shrink-0 items-center justify-center rounded-base border-2 border-border text-main-foreground ${
                scanning ? "bg-main" : "bg-chart-4"
              }`}
            >
              <Radar
                className={`size-4 ${scanning ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </div>
            <div className="nb-mono truncate text-xs font-bold">
              {scannerHeadline}
            </div>
          </div>

          <Badge variant="neutral" className="nb-mono">
            {formatTimestamp(report.scannedAt, locale)}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4" aria-hidden="true" />
              <span>
                {isPt ? "Processador e plataforma" : "Processor & Platform"}
              </span>
            </CardTitle>
            <Badge variant="default" className="nb-mono">
              {formatPercent(hardware.cpu.usagePercent)}
            </Badge>
          </CardHeader>

          <CardContent className="space-y-2.5 text-xs">
            <SpecRow
              label={isPt ? "Modelo da CPU" : "CPU Model"}
              value={hardware.cpu.brand}
            />
            <SpecRow
              label={isPt ? "Núcleos" : "Cores"}
              value={
                isPt
                  ? `${hardware.cpu.physicalCores} físicos / ${hardware.cpu.logicalCores} lógicos`
                  : `${hardware.cpu.physicalCores} physical / ${hardware.cpu.logicalCores} logical`
              }
              mono
            />
            <SpecRow
              label={isPt ? "Frequência base" : "Base Frequency"}
              value={formatFrequencyMhz(hardware.cpu.frequencyMhz)}
              mono
            />
            <SpecRow
              label={isPt ? "Sistema operacional" : "Operating System"}
              value={`${hardware.os.name} ${hardware.os.version} (${hardware.os.arch})`}
            />
            <SpecRow label="Hostname" value={hardware.os.hostname} mono />
            <SpecRow
              label={isPt ? "Tempo ativo" : "Uptime"}
              value={formatUptime(hardware.os.uptimeSeconds)}
              mono
            />
            <SpecRow
              label={isPt ? "Plano de energia" : "Power Plan"}
              value={hardware.powerPlan.name}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4" aria-hidden="true" />
              <span>
                {isPt ? "Memória e placas de vídeo" : "Memory & Graphics"}
              </span>
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-heading font-bold">
                  {isPt ? "RAM física" : "Physical RAM"}
                </span>
                <span className="nb-mono font-bold">
                  {formatBytes(hardware.memory.usedBytes)} /{" "}
                  {formatBytes(hardware.memory.totalBytes)} (
                  {formatPercent(memPercent)})
                </span>
              </div>
              <Progress value={memPercent} indicatorClassName="bg-chart-4" />
              <div className="nb-mono text-[11px] text-foreground/70">
                {isPt ? "Disponível" : "Available"}:{" "}
                {formatBytes(hardware.memory.availableBytes)}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-heading font-bold">
                  {isPt ? "Arquivo de paginação" : "Pagefile / Swap"}
                </span>
                <span className="nb-mono text-foreground/75">
                  {formatBytes(hardware.memory.swapUsedBytes)} /{" "}
                  {formatBytes(hardware.memory.swapTotalBytes)}
                </span>
              </div>
              <Progress value={swapPercent} indicatorClassName="bg-chart-5" />
            </div>

            <div className="border-t-2 border-border pt-3.5">
              <div className="mb-2.5 font-heading text-xs font-bold uppercase text-foreground/75">
                {isPt ? "Controladores gráficos" : "Display Adapters"} (
                {hardware.gpus.length})
              </div>
              {hardware.gpus.length === 0 ? (
                <p className="text-xs text-foreground/70">
                  {isPt
                    ? "Nenhuma GPU reportada via WMI."
                    : "No GPUs reported via WMI."}
                </p>
              ) : (
                <div className="space-y-2">
                  {hardware.gpus.map((gpu, idx) => (
                    <div
                      key={`${gpu.name}-${idx}`}
                      className="rounded-base border-2 border-border bg-background p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-heading text-xs font-bold">
                          {gpu.name}
                        </span>
                        <Badge variant="safe" className="nb-mono">
                          {gpu.status || "OK"}
                        </Badge>
                      </div>
                      <div className="nb-mono mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-foreground/75">
                        <span>Driver: {gpu.driverVersion}</span>
                        <span>
                          VRAM:{" "}
                          {gpu.vramBytes > 0
                            ? formatBytes(gpu.vramBytes)
                            : isPt
                              ? "Não reportada"
                              : "Not reported"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b-2 border-border bg-main/15 px-5 py-3.5">
          <HardDrive className="size-4" aria-hidden="true" />
          <h2 className="font-heading text-base font-bold">
            {isPt ? "Armazenamento" : "Storage"} ({hardware.disks.length})
          </h2>
        </div>

        <div className="divide-y-2 divide-border">
          {hardware.disks.map((disk) => {
            const used = Math.max(0, disk.totalBytes - disk.availableBytes);
            const pct =
              disk.totalBytes > 0 ? (used / disk.totalBytes) * 100 : 0;
            return (
              <div
                key={`${disk.mountPoint}-${disk.name}`}
                className="grid grid-cols-1 items-center gap-3 px-5 py-3.5 md:grid-cols-12"
              >
                <div className="md:col-span-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="nb-mono text-sm font-bold">
                      {disk.mountPoint}
                    </span>
                    <Badge variant="neutral">{disk.kind}</Badge>
                    <span className="nb-mono text-[11px] text-foreground/70">
                      {disk.fileSystem || "—"}
                    </span>
                  </div>
                  {disk.name && (
                    <div className="mt-0.5 truncate text-xs text-foreground/70">
                      {disk.name}
                    </div>
                  )}
                </div>

                <div className="md:col-span-5">
                  <Progress
                    value={pct}
                    indicatorClassName={
                      pct >= 90
                        ? "bg-chart-2"
                        : pct >= 80
                          ? "bg-chart-3"
                          : "bg-main"
                    }
                  />
                </div>

                <div className="nb-mono text-right text-xs md:col-span-3">
                  <div className="font-bold">
                    {formatBytes(disk.availableBytes)}{" "}
                    {isPt ? "livres" : "free"}
                  </div>
                  <div className="text-[11px] text-foreground/70">
                    {formatBytes(used)} / {formatBytes(disk.totalBytes)} (
                    {formatPercent(pct)})
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Monitor className="size-4" aria-hidden="true" />
              <span>
                {isPt ? "Monitores" : "Monitors"} ({peripherals.monitors.length}
                )
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {peripherals.monitors.length === 0 ? (
              <p className="text-xs text-foreground/70">
                {isPt
                  ? "Nenhum monitor ativo detectado."
                  : "No active monitors detected."}
              </p>
            ) : (
              peripherals.monitors.map((mon) => (
                <div
                  key={mon.deviceName}
                  className="rounded-base border-2 border-border bg-background p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="nb-mono text-xs font-bold">
                      {mon.width}×{mon.height} @ {mon.refreshRateHz} Hz
                    </span>
                    {mon.isPrimary && (
                      <Badge variant="default">
                        {isPt ? "Principal" : "Primary"}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs font-medium">
                    {mon.adapterString}
                  </div>
                  <div className="nb-mono mt-0.5 truncate text-[11px] text-foreground/70">
                    {mon.deviceName}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mouse className="size-4" aria-hidden="true" />
              <span>
                {isPt ? "Mouses" : "Mice"} ({peripherals.mice.length})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {peripherals.mice.length === 0 ? (
              <p className="text-xs text-foreground/70">
                {isPt
                  ? "Nenhum dispositivo apontador listado."
                  : "No pointing devices detected."}
              </p>
            ) : (
              peripherals.mice.map((device, idx) => (
                <div
                  key={`${device.deviceId}-${idx}`}
                  className="rounded-base border-2 border-border bg-background p-3"
                >
                  <div className="truncate font-heading text-xs font-bold">
                    {device.name}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-foreground/75">
                      {device.manufacturer}
                    </span>
                    <Badge variant="safe" className="nb-mono">
                      {device.status || "OK"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Keyboard className="size-4" aria-hidden="true" />
              <span>
                {isPt ? "Teclados" : "Keyboards"} ({peripherals.keyboards.length}
                )
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {peripherals.keyboards.length === 0 ? (
              <p className="text-xs text-foreground/70">
                {isPt
                  ? "Nenhum teclado listado via WMI."
                  : "No keyboards reported via WMI."}
              </p>
            ) : (
              peripherals.keyboards.map((device, idx) => (
                <div
                  key={`${device.deviceId}-${idx}`}
                  className="rounded-base border-2 border-border bg-background p-3"
                >
                  <div className="truncate font-heading text-xs font-bold">
                    {device.name}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-foreground/75">
                      {device.manufacturer}
                    </span>
                    <Badge variant="safe" className="nb-mono">
                      {device.status || "OK"}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b-2 border-border bg-main/15 px-5 py-3.5">
          <Network className="size-4" aria-hidden="true" />
          <h2 className="font-heading text-base font-bold">
            {isPt ? "Interfaces de rede" : "Network Interfaces"} (
            {hardware.networks.length})
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b-2 border-border bg-background font-heading font-bold">
                <th className="px-5 py-2.5">{isPt ? "Adaptador" : "Adapter"}</th>
                <th className="px-5 py-2.5">
                  {isPt ? "Endereço MAC" : "MAC Address"}
                </th>
                <th className="px-5 py-2.5 text-right">
                  {isPt ? "Recebido total" : "Total Received"}
                </th>
                <th className="px-5 py-2.5 text-right">
                  {isPt ? "Enviado total" : "Total Transmitted"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-border">
              {hardware.networks.map((net) => (
                <tr key={`${net.name}-${net.macAddress}`}>
                  <td className="px-5 py-2.5 font-heading font-bold">
                    {net.name}
                  </td>
                  <td className="nb-mono px-5 py-2.5 text-foreground/75">
                    {net.macAddress || "—"}
                  </td>
                  <td className="nb-mono px-5 py-2.5 text-right font-bold">
                    {formatBytes(net.totalReceivedBytes)}
                  </td>
                  <td className="nb-mono px-5 py-2.5 text-right font-bold">
                    {formatBytes(net.totalTransmittedBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
});

function SpecRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/30 pb-2 last:border-b-0 last:pb-0">
      <span className="shrink-0 text-foreground/70">{label}</span>
      <span
        className={`truncate text-right font-bold ${mono ? "nb-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
