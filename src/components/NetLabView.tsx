import { memo, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gamepad2,
  Globe,
  Network,
  Plus,
  Radar,
  RefreshCw,
  Route,
  ShieldAlert,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  localizeBottleneckSummary,
  localizeMtuHint,
  localizeNetFlushMessage,
  localizeNicProperty,
} from "../i18n";
import { normalizeAppError, tauriClient } from "../services/tauriClient";
import type {
  ActiveDnsStatus,
  AppError,
  AppLocale,
  DnsBenchmarkEntry,
  MtuDiscoveryResult,
  NicDriverProperty,
  PrivilegeStatus,
  QosGamePolicy,
  RouteProbeResult,
  RouteTraceReport,
} from "../types/system";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";

interface NetLabViewProps {
  locale: AppLocale;
  privilege: PrivilegeStatus | null;
  elevating: boolean;
  onRequestElevation: () => void;
  onMutationComplete: () => Promise<void> | void;
}

const GAME_QOS_PRESETS: Array<{ gameName: string; exeName: string }> = [
  { gameName: "Counter-Strike 2", exeName: "cs2.exe" },
  { gameName: "Valorant", exeName: "VALORANT-Win64-Shipping.exe" },
  { gameName: "Fortnite", exeName: "FortniteClient-Win64-Shipping.exe" },
  { gameName: "Call of Duty", exeName: "cod.exe" },
  { gameName: "Apex Legends", exeName: "r5apex.exe" },
  { gameName: "League of Legends", exeName: "League of Legends.exe" },
  { gameName: "Dota 2", exeName: "dota2.exe" },
  { gameName: "Overwatch 2", exeName: "Overwatch.exe" },
  { gameName: "Rainbow Six Siege", exeName: "RainbowSix.exe" },
  { gameName: "Deadlock", exeName: "project8.exe" },
];

export const NetLabView = memo(function NetLabView({
  locale,
  privilege,
  elevating,
  onRequestElevation,
  onMutationComplete,
}: NetLabViewProps) {
  const isPt = locale === "pt";
  const isAdmin = privilege?.isAdmin ?? false;

  const [routes, setRoutes] = useState<RouteProbeResult[]>([]);
  const [probingRoutes, setProbingRoutes] = useState(false);

  const [traceReport, setTraceReport] = useState<RouteTraceReport | null>(null);
  const [tracingHost, setTracingHost] = useState<string | null>(null);

  const [dnsEntries, setDnsEntries] = useState<DnsBenchmarkEntry[]>([]);
  const [currentDns, setCurrentDns] = useState<ActiveDnsStatus | null>(null);
  const [testingDns, setTestingDns] = useState(false);
  const [applyingDnsId, setApplyingDnsId] = useState<string | null>(null);

  const [mtuResult, setMtuResult] = useState<MtuDiscoveryResult | null>(null);
  const [discoveringMtu, setDiscoveringMtu] = useState(false);
  const [applyingMtu, setApplyingMtu] = useState(false);

  const [qosPolicies, setQosPolicies] = useState<QosGamePolicy[]>([]);
  const [customGameName, setCustomGameName] = useState("");
  const [customExeName, setCustomExeName] = useState("");
  const [busyQos, setBusyQos] = useState(false);

  const [nicProps, setNicProps] = useState<NicDriverProperty[]>([]);
  const [busyNicId, setBusyNicId] = useState<string | null>(null);

  const [flushingNet, setFlushingNet] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const refreshLocalState = useCallback(async () => {
    const [policiesRes, nicRes, dnsRes] = await Promise.allSettled([
      tauriClient.listQosPolicies(),
      tauriClient.listNicDriverTweaks(),
      tauriClient.getCurrentDnsStatus(),
    ]);
    if (policiesRes.status === "fulfilled") {
      setQosPolicies(policiesRes.value);
    }
    if (nicRes.status === "fulfilled") {
      setNicProps(nicRes.value);
    }
    if (dnsRes.status === "fulfilled") {
      setCurrentDns(dnsRes.value);
    }
  }, []);

  useEffect(() => {
    void refreshLocalState();
  }, [refreshLocalState]);

  const handleProbeRoutes = async () => {
    setProbingRoutes(true);
    setError(null);
    try {
      const list = await tauriClient.probeGameRoutes();
      setRoutes(list);
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setProbingRoutes(false);
    }
  };

  const handleTraceRoute = async (host: string) => {
    setTracingHost(host);
    setError(null);
    try {
      const report = await tauriClient.traceRouteHops(host);
      setTraceReport(report);
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setTracingHost(null);
    }
  };

  const handleRunDnsBenchmark = async () => {
    setTestingDns(true);
    setError(null);
    try {
      const [entries, activeDns] = await Promise.all([
        tauriClient.runMultiDnsBenchmark(),
        tauriClient.getCurrentDnsStatus().catch(() => null),
      ]);
      setDnsEntries(entries);
      if (activeDns) {
        setCurrentDns(activeDns);
      }
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setTestingDns(false);
    }
  };

  const handleApplyDns = async (entry: DnsBenchmarkEntry) => {
    if (!isAdmin || applyingDnsId) return;
    setApplyingDnsId(entry.providerId);
    setError(null);
    setStatusBanner(null);
    try {
      const result = await tauriClient.applyCustomDnsProvider(
        entry.primaryIp,
        entry.secondaryIp,
        entry.providerName
      );
      if (result?.currentDns) {
        setCurrentDns(result.currentDns);
      } else {
        setCurrentDns({
          interfaceAlias: currentDns?.interfaceAlias ?? "Ethernet",
          servers: [entry.primaryIp, entry.secondaryIp].filter(Boolean),
          isDhcp: false,
          matchedProviderId: entry.providerId,
          matchedProviderName: entry.providerName,
        });
      }
      setStatusBanner(
        isPt
          ? `DNS ${entry.providerName} (${entry.primaryIp}) aplicado com snapshot atômico salvo.`
          : `DNS ${entry.providerName} (${entry.primaryIp}) applied with atomic snapshot saved.`
      );
      await onMutationComplete();
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setApplyingDnsId(null);
    }
  };

  const handleDiscoverMtu = async () => {
    setDiscoveringMtu(true);
    setError(null);
    try {
      const res = await tauriClient.discoverOptimalMtu();
      setMtuResult(res);
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setDiscoveringMtu(false);
    }
  };

  const handleApplyMtu = async () => {
    if (!mtuResult || !isAdmin || applyingMtu) return;
    setApplyingMtu(true);
    setError(null);
    setStatusBanner(null);
    try {
      await tauriClient.applyOptimalMtu(
        mtuResult.interfaceAlias,
        mtuResult.optimalMtu
      );
      setMtuResult({
        ...mtuResult,
        currentMtu: mtuResult.optimalMtu,
        isOptimal: true,
      });
      setStatusBanner(
        isPt
          ? `MTU ${mtuResult.optimalMtu} aplicado em '${mtuResult.interfaceAlias}' com backup atômico.`
          : `MTU ${mtuResult.optimalMtu} applied on '${mtuResult.interfaceAlias}' with atomic backup.`
      );
      await onMutationComplete();
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setApplyingMtu(false);
    }
  };

  const handleAddQosPreset = async (gameName: string, exeName: string) => {
    if (!isAdmin || busyQos) return;
    setBusyQos(true);
    setError(null);
    setStatusBanner(null);
    try {
      await tauriClient.addQosGamePolicy(gameName, exeName);
      setCustomGameName("");
      setCustomExeName("");
      await refreshLocalState();
      await onMutationComplete();
      setStatusBanner(
        isPt
          ? `Prioridade máxima QoS DSCP 46 (EF) ativada para ${gameName} (${exeName}).`
          : `Maximum QoS DSCP 46 (EF) priority enabled for ${gameName} (${exeName}).`
      );
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setBusyQos(false);
    }
  };

  const handleRemoveQos = async (policyName: string) => {
    if (!isAdmin || busyQos) return;
    setBusyQos(true);
    setError(null);
    try {
      await tauriClient.removeQosGamePolicy(policyName);
      await refreshLocalState();
      await onMutationComplete();
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setBusyQos(false);
    }
  };

  const handleOptimizeNicProp = async (prop: NicDriverProperty) => {
    if (!isAdmin || busyNicId) return;
    setBusyNicId(prop.id);
    setError(null);
    setStatusBanner(null);
    try {
      await tauriClient.applyNicDriverTweak(
        prop.subkey,
        prop.valueName,
        prop.recommendedValue,
        prop.displayName
      );
      await refreshLocalState();
      await onMutationComplete();
      setStatusBanner(
        isPt
          ? `Propriedade de hardware '${prop.displayName}' otimizada com backup atômico.`
          : `Hardware property '${prop.displayName}' optimized with atomic backup.`
      );
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setBusyNicId(null);
    }
  };

  const handleFlushNetwork = async () => {
    setFlushingNet(true);
    setError(null);
    setStatusBanner(null);
    try {
      const msg = await tauriClient.flushNetworkStack();
      setStatusBanner(localizeNetFlushMessage(msg, locale));
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setFlushingNet(false);
    }
  };

  const activeExes = new Set(
    qosPolicies.map((p) => p.exeName.toLowerCase())
  );

  return (
    <div className="space-y-5">
      {privilege && !privilege.isAdmin && (
        <Alert variant="warning">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertTitle>
            {isPt
              ? "Modo Leitura / Diagnóstico (Elevação recomendada para aplicar QoS, MTU e DNS)"
              : "Read / Diagnostic Mode (Elevation required to apply QoS, MTU, and DNS)"}
          </AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="max-w-2xl text-xs">
              {isPt
                ? "Os testes de Rota, Traceroute, Benchmark DNS UDP e Descoberta de MTU funcionam livremente, mas aplicar políticas QoS DSCP 46, MTU ou Driver NIC requer Administrador."
                : "Route probing, Traceroute, UDP DNS Benchmark, and MTU Discovery work freely, while applying QoS DSCP 46, MTU, or NIC Driver tuning requires Administrator."}
            </span>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              disabled={elevating}
              onClick={onRequestElevation}
            >
              {elevating
                ? isPt
                  ? "Aguardando UAC..."
                  : "Waiting for UAC..."
                : isPt
                  ? "Elevar como Admin"
                  : "Elevate as Admin"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>[{error.code}]</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {statusBanner && (
        <Alert variant="success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          <AlertTitle>{isPt ? "Operação NetLab concluída" : "NetLab Operation Completed"}</AlertTitle>
          <AlertDescription>{statusBanner}</AlertDescription>
        </Alert>
      )}

      {/* 1. Radar de Ping, Jitter & Packet Loss por Região + Traceroute Hop-by-Hop */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
              <Radar className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">
                {isPt
                  ? "Radar de Rotas Regionais (Ping, Jitter & Perda de Pacotes)"
                  : "Regional Game Route Radar (Ping, Jitter & Packet Loss)"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-foreground/75">
                {isPt
                  ? "Sonda clusters reais de servidores de jogos e inspeciona cada salto (Hop-by-Hop) para localizar gargalos no Wi-Fi, CGNAT/Operadora ou Backbone"
                  : "Probes real regional game server clusters and inspects Hop-by-Hop routes to pinpoint Wi-Fi, ISP/CGNAT, or Backbone bottlenecks"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="neutral"
              size="sm"
              disabled={flushingNet}
              onClick={() => void handleFlushNetwork()}
            >
              <Zap className="size-3.5" aria-hidden="true" />
              <span>
                {flushingNet
                  ? isPt
                    ? "Limpando..."
                    : "Flushing..."
                  : isPt
                    ? "Instant Net Flush (DNS/ARP)"
                    : "Instant Net Flush (DNS/ARP)"}
              </span>
            </Button>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={probingRoutes}
              onClick={() => void handleProbeRoutes()}
            >
              <RefreshCw
                className={`size-3.5 ${probingRoutes ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>
                {probingRoutes
                  ? isPt
                    ? "Sondando 5 Regiões..."
                    : "Probing 5 Regions..."
                  : isPt
                    ? "Sondar Rotas de Jogos"
                    : "Probe Game Routes"}
              </span>
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {routes.length === 0 ? (
            <div className="rounded-base border-2 border-border bg-background p-4 text-xs text-foreground/80">
              {isPt
                ? "Clique em 'Sondar Rotas de Jogos' para medir Ping Médio, Jitter (variação entre pacotes) e Perda de Pacotes até São Paulo (GRU), Santiago, Virgínia, Oregon e Frankfurt."
                : "Click 'Probe Game Routes' to measure Average Ping, Jitter, and Packet Loss to São Paulo (GRU), Santiago, Virginia, Oregon, and Frankfurt."}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
              {routes.map((r) => {
                const ping = r.avgMs;
                const badgeVariant =
                  ping === null
                    ? "advanced"
                    : ping <= 45
                      ? "safe"
                      : ping <= 135
                        ? "default"
                        : "moderate";
                const isTracingThis = tracingHost === r.targetHost;

                return (
                  <div
                    key={r.id}
                    className="flex flex-col justify-between gap-3 rounded-base border-2 border-border bg-background p-3.5"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-heading text-xs font-bold">
                          {r.regionName}
                        </span>
                        <Badge variant={badgeVariant} className="nb-mono">
                          {ping !== null ? `${ping.toFixed(1)} ms` : "Offline"}
                        </Badge>
                      </div>
                      <div className="mt-1 text-[11px] text-foreground/75">
                        {r.location}
                      </div>

                      <div className="nb-mono mt-3 space-y-1 border-t border-border/30 pt-2 text-[11px]">
                        <div className="flex justify-between">
                          <span className="text-foreground/70">Jitter:</span>
                          <span className="font-bold">
                            {r.jitterMs !== null
                              ? `${r.jitterMs.toFixed(1)} ms`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-foreground/70">Min / Max:</span>
                          <span>
                            {r.minMs !== null && r.maxMs !== null
                              ? `${r.minMs.toFixed(0)}/${r.maxMs.toFixed(0)} ms`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-foreground/70">Loss:</span>
                          <span
                            className={
                              r.lossPercent > 0 ? "font-bold text-chart-2" : ""
                            }
                          >
                            {r.lossPercent.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="neutral"
                      size="xs"
                      disabled={tracingHost !== null}
                      onClick={() => void handleTraceRoute(r.targetHost)}
                      className="w-full"
                    >
                      <Route className="size-3" aria-hidden="true" />
                      <span>
                        {isTracingThis
                          ? isPt
                            ? "Traçando..."
                            : "Tracing..."
                          : isPt
                            ? "Traçar Saltos (Hops)"
                            : "Trace Hops"}
                      </span>
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {traceReport && (
            <div className="space-y-3 rounded-base border-2 border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-heading text-sm font-bold">
                    {isPt
                      ? `Inspetor Hop-by-Hop -> ${traceReport.targetHost}`
                      : `Hop-by-Hop Route Inspector -> ${traceReport.targetHost}`}
                  </h3>
                  <p className="mt-0.5 text-xs font-medium text-foreground/85">
                    {localizeBottleneckSummary(
                      traceReport.bottleneckSummary,
                      locale
                    )}
                  </p>
                </div>
                <Badge
                  variant={traceReport.bottleneckHop ? "moderate" : "safe"}
                >
                  {traceReport.hops.length} Hops
                </Badge>
              </div>

              <div className="overflow-x-auto rounded-base border-2 border-border bg-secondary-background">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b-2 border-border bg-background font-heading font-bold">
                      <th className="px-3 py-2">Hop</th>
                      <th className="px-3 py-2">
                        {isPt ? "Segmento" : "Stage"}
                      </th>
                      <th className="px-3 py-2">IP / Router</th>
                      <th className="px-3 py-2 text-right">RTT 1 / 2 / 3</th>
                      <th className="px-3 py-2 text-right">
                        {isPt ? "Média" : "Average"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {traceReport.hops.map((h) => {
                      const isBottleneck = traceReport.bottleneckHop === h.hop;
                      return (
                        <tr
                          key={h.hop}
                          className={isBottleneck ? "bg-chart-3/25" : ""}
                        >
                          <td className="nb-mono px-3 py-2 font-bold">
                            #{h.hop}
                          </td>
                          <td className="px-3 py-2">
                            <Badge
                              variant={
                                h.stage === "local"
                                  ? "safe"
                                  : h.stage === "isp"
                                    ? "moderate"
                                    : h.stage === "backbone"
                                      ? "default"
                                      : "neutral"
                              }
                            >
                              {h.stage.toUpperCase()}
                            </Badge>
                          </td>
                          <td className="nb-mono px-3 py-2 font-bold">
                            {h.ipAddress}
                          </td>
                          <td className="nb-mono px-3 py-2 text-right text-foreground/75">
                            {[h.rtt1Ms, h.rtt2Ms, h.rtt3Ms]
                              .map((v) =>
                                v !== null ? `${v.toFixed(0)}ms` : "*"
                              )
                              .join(" / ")}
                          </td>
                          <td className="nb-mono px-3 py-2 text-right font-bold">
                            {h.avgMs !== null
                              ? `${h.avgMs.toFixed(1)} ms`
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Game Packet Prioritizer — QoS DSCP 46 (Expedited Forwarding) */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-base border-2 border-border bg-chart-4 text-main-foreground">
              <Gamepad2 className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">
                {isPt
                  ? "Game Packet Prioritizer — QoS DSCP 46 (Expedited Forwarding)"
                  : "Game Packet Prioritizer — QoS DSCP 46 (Expedited Forwarding)"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-foreground/75">
                {isPt
                  ? "Marca todos os pacotes TCP/UDP do jogo com DSCP 46 (EF) no agendador de pacotes do kernel Windows (Pacer.sys), furando a fila de downloads, streams e navegador (funciona em Windows Home e Pro)"
                  : "Tags all outbound TCP/UDP game packets with DSCP 46 (EF) in the Windows kernel packet scheduler (Pacer.sys), bypassing background downloads and browser queues (works on Windows Home & Pro)"}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <div className="mb-2 font-heading text-xs font-bold uppercase text-foreground/75">
              {isPt
                ? "Ativar Prioridade DSCP 46 em 1 Clique (Presets de Jogos)"
                : "1-Click DSCP 46 Priority (Game Presets)"}
            </div>
            <div className="flex flex-wrap gap-2">
              {GAME_QOS_PRESETS.map((preset) => {
                const alreadyActive = activeExes.has(
                  preset.exeName.toLowerCase()
                );
                return (
                  <Button
                    key={preset.exeName}
                    type="button"
                    variant={alreadyActive ? "success" : "neutral"}
                    size="xs"
                    disabled={!isAdmin || busyQos || alreadyActive}
                    onClick={() =>
                      void handleAddQosPreset(preset.gameName, preset.exeName)
                    }
                  >
                    <Sparkles className="size-3" aria-hidden="true" />
                    <span>{preset.gameName}</span>
                    <span className="nb-mono text-[10px] opacity-80">
                      ({preset.exeName})
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2.5 border-t-2 border-border pt-3.5 sm:flex-row sm:items-center">
            <Input
              type="text"
              value={customGameName}
              onChange={(e) => setCustomGameName(e.target.value)}
              placeholder={
                isPt ? "Nome do Jogo (ex: Marvel Rivals)" : "Game Name"
              }
              disabled={!isAdmin || busyQos}
              aria-label={isPt ? "Nome do jogo para QoS" : "Game name for QoS"}
              className="h-9 text-xs sm:w-56"
            />
            <Input
              type="text"
              value={customExeName}
              onChange={(e) => setCustomExeName(e.target.value)}
              placeholder={
                isPt
                  ? "Executável exato (ex: MarvelRivals.exe)"
                  : "Exact executable (e.g. game.exe)"
              }
              disabled={!isAdmin || busyQos}
              aria-label={
                isPt ? "Executável do jogo para QoS" : "Game executable for QoS"
              }
              className="nb-mono h-9 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={
                !isAdmin ||
                busyQos ||
                !customExeName.trim().toLowerCase().endsWith(".exe")
              }
              onClick={() =>
                void handleAddQosPreset(
                  customGameName.trim() || customExeName.trim(),
                  customExeName.trim()
                )
              }
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>
                {isPt ? "Adicionar Política DSCP 46" : "Add DSCP 46 Policy"}
              </span>
            </Button>
          </div>

          {qosPolicies.length > 0 && (
            <div className="space-y-2 border-t-2 border-border pt-3.5">
              <div className="font-heading text-xs font-bold uppercase text-foreground/75">
                {isPt
                  ? `Políticas QoS DSCP 46 Ativas no Kernel (${qosPolicies.length})`
                  : `Active Kernel QoS DSCP 46 Policies (${qosPolicies.length})`}
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {qosPolicies.map((pol) => (
                  <div
                    key={pol.policyName}
                    className="flex items-center justify-between gap-2 rounded-base border-2 border-border bg-background px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-heading text-xs font-bold">
                          {pol.gameName}
                        </span>
                        <Badge variant="safe" className="nb-mono">
                          DSCP {pol.dscpValue}
                        </Badge>
                      </div>
                      <div className="nb-mono truncate text-[11px] text-foreground/75">
                        {pol.exeName}
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="neutral"
                      size="icon-xs"
                      disabled={!isAdmin || busyQos}
                      onClick={() => void handleRemoveQos(pol.policyName)}
                      aria-label={
                        isPt
                          ? `Remover QoS ${pol.gameName}`
                          : `Remove QoS ${pol.gameName}`
                      }
                      title={isPt ? "Remover política QoS" : "Remove QoS policy"}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Multi-DNS UDP Benchmark + Auto-MTU Finder Sem Fragmentação */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-chart-3 text-main-foreground">
                <Globe className="size-4" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-base">
                  1-Click Multi-DNS Benchmark (UDP)
                </CardTitle>
                <p className="mt-0.5 text-xs text-foreground/75">
                  {isPt
                    ? "Testa 6 provedores via pacotes UDP RFC 1035 diretos sem cache do Windows"
                    : "Tests 6 resolvers via raw RFC 1035 UDP packets bypassing OS DNS cache"}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={testingDns}
              onClick={() => void handleRunDnsBenchmark()}
            >
              <Activity
                className={`size-3.5 ${testingDns ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>
                {testingDns
                  ? isPt
                    ? "Testando..."
                    : "Testing..."
                  : isPt
                    ? "Testar 6 DNS"
                    : "Test 6 DNS"}
              </span>
            </Button>
          </CardHeader>

          <CardContent className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-base border-2 border-border bg-background px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[10.5px] font-heading font-bold uppercase text-foreground/65">
                  {isPt ? "DNS Atual Aplicado" : "Current DNS Applied"}
                </div>
                {currentDns ? (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-heading font-bold">
                      {currentDns.matchedProviderName
                        ? currentDns.matchedProviderName
                        : currentDns.isDhcp
                          ? isPt
                            ? "DHCP (Automático)"
                            : "DHCP (Automatic)"
                          : isPt
                            ? "DNS Customizado"
                            : "Custom DNS"}
                    </span>
                    <span className="nb-mono text-[11px] text-foreground/80">
                      {currentDns.servers.length > 0
                        ? currentDns.servers.join(" / ")
                        : isPt
                          ? "Automático"
                          : "Auto"}
                    </span>
                  </div>
                ) : (
                  <div className="nb-mono mt-0.5 text-[11px] text-foreground/70">
                    {isPt ? "Detectando interface ativa..." : "Detecting active adapter..."}
                  </div>
                )}
              </div>

              {currentDns && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge variant="neutral" className="nb-mono">
                    {currentDns.interfaceAlias}
                  </Badge>
                  <Badge
                    variant={currentDns.isDhcp ? "neutral" : "safe"}
                    className="nb-mono"
                  >
                    {currentDns.isDhcp ? "DHCP" : "STATIC"}
                  </Badge>
                </div>
              )}
            </div>

            {dnsEntries.length === 0 ? (
              <div className="rounded-base border-2 border-border bg-background p-4 text-xs text-foreground/80">
                {isPt
                  ? "Clique em 'Testar 6 DNS' para descobrir matematicamente qual servidor responde mais rápido na rota da sua operadora."
                  : "Click 'Test 6 DNS' to benchmark which DNS resolver responds fastest on your ISP route."}
              </div>
            ) : (
              dnsEntries.map((entry, index) => {
                const avg = entry.avgMs;
                const barPct =
                  avg !== null ? Math.max(8, Math.min(100, 100 - avg)) : 0;
                const isAppliedDns = Boolean(
                  currentDns &&
                    (currentDns.matchedProviderId === entry.providerId ||
                      currentDns.servers[0]?.trim() === entry.primaryIp)
                );
                const isApplyingThis = applyingDnsId === entry.providerId;
                return (
                  <div
                    key={entry.providerId}
                    className="space-y-1.5 rounded-base border-2 border-border bg-background p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {index === 0 && avg !== null && (
                          <Badge variant="safe">#1 FASTEST</Badge>
                        )}
                        <span className="font-heading text-xs font-bold">
                          {entry.providerName}
                        </span>
                        <span className="nb-mono text-[11px] text-foreground/70">
                          ({entry.primaryIp})
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="nb-mono text-xs font-bold">
                          {avg !== null ? `${avg.toFixed(1)} ms` : "Timeout"}
                        </span>
                        {entry.jitterMs !== null && (
                          <span className="nb-mono text-[11px] text-foreground/70">
                            (±{entry.jitterMs.toFixed(1)}ms)
                          </span>
                        )}
                        <Button
                          type="button"
                          variant={
                            isAppliedDns || index === 0 ? "success" : "neutral"
                          }
                          size="xs"
                          disabled={
                            !isAdmin ||
                            applyingDnsId !== null ||
                            avg === null ||
                            isAppliedDns
                          }
                          onClick={() => void handleApplyDns(entry)}
                        >
                          {isApplyingThis ? (
                            <>
                              <RefreshCw
                                className="size-3 animate-spin"
                                aria-hidden="true"
                              />
                              <span>
                                {isPt ? "Aplicando..." : "Applying..."}
                              </span>
                            </>
                          ) : isAppliedDns ? (
                            <>
                              <CheckCircle2
                                className="size-3"
                                aria-hidden="true"
                              />
                              <span>{isPt ? "Aplicado" : "Applied"}</span>
                            </>
                          ) : isPt ? (
                            "Aplicar"
                          ) : (
                            "Apply"
                          )}
                        </Button>
                      </div>
                    </div>
                    <Progress
                      value={barPct}
                      className="h-2"
                      indicatorClassName={
                        isAppliedDns || index === 0 ? "bg-chart-4" : "bg-main"
                      }
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-chart-5 text-main-foreground">
                <Network className="size-4" aria-hidden="true" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {isPt
                    ? "Auto-MTU Finder (Zero Fragmentação)"
                    : "Auto-MTU Finder (Zero Fragmentation)"}
                </CardTitle>
                <p className="mt-0.5 text-xs text-foreground/75">
                  {isPt
                    ? "Busca binária com flag Don't Fragment (DF) para eliminar fragmentação PPPoE"
                    : "Binary search with Don't Fragment (DF) flag to eliminate PPPoE packet fragmentation"}
                </p>
              </div>
            </div>

            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={discoveringMtu}
              onClick={() => void handleDiscoverMtu()}
            >
              <RefreshCw
                className={`size-3.5 ${discoveringMtu ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>
                {discoveringMtu
                  ? isPt
                    ? "Calculando DF..."
                    : "Probing DF..."
                  : isPt
                    ? "Descobrir MTU Ideal"
                    : "Find Optimal MTU"}
              </span>
            </Button>
          </CardHeader>

          <CardContent className="space-y-3">
            {!mtuResult ? (
              <div className="rounded-base border-2 border-border bg-background p-4 text-xs text-foreground/80">
                {isPt
                  ? "Em conexões de fibra PPPoE, o MTU padrão 1500 pode fragmentar pacotes UDP de jogos. Clique em 'Descobrir MTU Ideal' para testar o tamanho exato sem fragmentação na sua linha."
                  : "On PPPoE fiber lines, the default 1500 MTU can fragment game UDP packets. Click 'Find Optimal MTU' to discover the exact non-fragmented payload ceiling."}
              </div>
            ) : (
              <div className="space-y-3 rounded-base border-2 border-border bg-background p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-heading text-xs font-bold">
                    {mtuResult.interfaceAlias}
                  </span>
                  <Badge variant={mtuResult.isOptimal ? "safe" : "moderate"}>
                    {mtuResult.isOptimal
                      ? isPt
                        ? "MTU Calibrado"
                        : "MTU Optimal"
                      : isPt
                        ? "Ajuste Recomendado"
                        : "Tuning Recommended"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-base border-2 border-border bg-secondary-background p-3">
                    <div className="text-[11px] text-foreground/70">
                      {isPt ? "MTU Atual" : "Current MTU"}
                    </div>
                    <div className="nb-mono mt-1 text-xl font-bold">
                      {mtuResult.currentMtu}
                    </div>
                  </div>

                  <div className="rounded-base border-2 border-border bg-secondary-background p-3">
                    <div className="text-[11px] text-foreground/70">
                      {isPt
                        ? "MTU Ótimo (Sem Fragmentar)"
                        : "Optimal MTU (No Fragment)"}
                    </div>
                    <div className="nb-mono mt-1 text-xl font-bold text-main">
                      {mtuResult.optimalMtu}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-foreground/80">
                  {localizeMtuHint(
                    mtuResult.connectionTypeHint,
                    mtuResult.optimalMtu,
                    locale
                  )}{" "}
                  ({isPt ? "Payload DF máx:" : "Max DF payload:"}{" "}
                  <strong className="nb-mono">
                    {mtuResult.maxUnfragmentedPayload} bytes
                  </strong>
                  )
                </p>

                {!mtuResult.isOptimal && (
                  <Button
                    type="button"
                    variant="success"
                    size="sm"
                    disabled={!isAdmin || applyingMtu}
                    onClick={() => void handleApplyMtu()}
                    className="w-full"
                  >
                    <span>
                      {applyingMtu
                        ? isPt
                          ? "Aplicando..."
                          : "Applying..."
                        : isPt
                          ? `Aplicar MTU ${mtuResult.optimalMtu} com Backup`
                          : `Apply MTU ${mtuResult.optimalMtu} with Backup`}
                    </span>
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 4. NIC Hardware Driver Advanced Properties */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
              <Cpu className="size-5" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">
                {isPt
                  ? "Propriedades Avançadas do Driver da Placa de Rede (NIC Hardware)"
                  : "NIC Hardware Driver Advanced Low-Latency Properties"}
              </CardTitle>
              <p className="mt-0.5 text-xs text-foreground/75">
                {isPt
                  ? "Ajuste direto no driver NDIS da placa de rede ativa (Interrupt Moderation, Flow Control, EEE e Large Send Offload) com backup atômico"
                  : "Direct NDIS hardware driver parameters on your active network card (Interrupt Moderation, Flow Control, EEE, and LSO) with atomic backup"}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {nicProps.length === 0 ? (
            <div className="rounded-base border-2 border-border bg-background p-4 text-xs text-foreground/80">
              {isPt
                ? "Nenhuma propriedade avançada customizável exposta pelo driver atual ou leitura pendente."
                : "No customizable NDIS advanced driver properties exposed by the current adapter."}
            </div>
          ) : (
            <div className="divide-y-2 divide-border rounded-base border-2 border-border bg-secondary-background">
              {nicProps.map((rawProp) => {
                const prop = localizeNicProperty(rawProp, locale);
                return (
                  <div
                    key={prop.id}
                    className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-heading text-xs font-bold">
                          {prop.displayName}
                        </span>
                        <Badge variant={prop.isOptimized ? "safe" : "moderate"}>
                          {prop.isOptimized
                            ? isPt
                              ? "Otimizado"
                              : "Optimized"
                            : isPt
                              ? `Atual: ${prop.currentValue}`
                              : `Current: ${prop.currentValue}`}
                        </Badge>
                        <Badge variant="neutral" className="nb-mono">
                          {prop.adapterName}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-foreground/75">
                        {prop.description}
                      </p>
                    </div>

                    {!prop.isOptimized && (
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        disabled={!isAdmin || busyNicId !== null}
                        onClick={() => void handleOptimizeNicProp(prop)}
                        className="shrink-0 self-start sm:self-center"
                      >
                        {busyNicId === prop.id
                          ? "..."
                          : isPt
                            ? "Otimizar Driver"
                            : "Optimize Driver"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
});
