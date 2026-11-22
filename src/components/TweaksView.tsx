import { memo, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Gauge,
  Globe,
  History,
  Keyboard,
  Lock,
  Monitor,
  RefreshCw,
  Rocket,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import {
  localizeTweak,
  localizeTweakTitle,
  REBOOT_REQUIRED_TWEAK_IDS,
} from "../i18n";
import type {
  AppError,
  AppLocale,
  ApplyTweaksResult,
  BackupSessionSummary,
  DiagnosticFinding,
  PrivilegeStatus,
  RevertSessionResult,
  TweakCategory,
  TweakImpact,
  TweakItem,
  TweakProgressEvent,
  TweakRisk,
} from "../types/system";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { Input } from "./ui/input";
import { Progress } from "./ui/progress";

interface TweaksViewProps {
  items: TweakItem[];
  selectedIds: string[];
  sessionLabel: string;
  createRestorePoint?: boolean;
  locale?: AppLocale;
  activeBackupSessions: BackupSessionSummary[];
  loading: boolean;
  busy: boolean;
  elevating?: boolean;
  progress: TweakProgressEvent | null;
  lastApplyResult: ApplyTweaksResult | null;
  lastRevertResult: RevertSessionResult | null;
  error: AppError | null;
  diagnostics: DiagnosticFinding[];
  privilege: PrivilegeStatus | null;
  onRefresh: () => void;
  onToggleSelect: (id: string) => void;
  onSetSelected: (ids: string[]) => void;
  onSessionLabelChange: (label: string) => void;
  onCreateRestorePointChange?: (enabled: boolean) => void;
  onClearSelection: () => void;
  onApplySelected: (sessionLabel?: string) => void;
  onRevertSingleTweak?: (tweakId: string) => void;
  onRevertAllActive: () => void;
  onRequestElevation: () => void;
  onInspectBackupSession: (sessionId: string) => void;
}

type CategoryFilter = "all" | TweakCategory;
type RiskFilter = "all" | TweakRisk;

const CATEGORY_META: Record<
  TweakCategory,
  { labelPt: string; labelEn: string; icon: typeof Cpu }
> = {
  gaming: { labelPt: "CPU & Gaming", labelEn: "CPU & Gaming", icon: Cpu },
  gpu: { labelPt: "GPU & DirectX", labelEn: "GPU & DirectX", icon: Monitor },
  network: { labelPt: "Rede & TCP/IP", labelEn: "Network & TCP/IP", icon: Globe },
  power: { labelPt: "Energia & Disco", labelEn: "Power & Storage", icon: Zap },
  input: { labelPt: "Periféricos", labelEn: "Peripherals", icon: Keyboard },
  debloat: { labelPt: "Debloat", labelEn: "Debloat", icon: SlidersHorizontal },
  security: { labelPt: "Segurança", labelEn: "Security", icon: Lock },
};

const COMPETITIVE_SAFE_PRESET_IDS = [
  "registry_mmcss_gaming",
  "gaming_win32_priority_separation",
  "gaming_global_timer_resolution",
  "registry_disable_gamedvr",
  "gaming_disable_power_throttling",
  "gaming_disable_game_bar_tips",
  "gaming_mmcss_audio_priority",
  "gpu_tdr_delay",
  "gpu_windowed_optimizations",
  "gpu_disable_transparency_dwm",
  "gpu_disable_dwm_animations",
  "network_dns_cloudflare",
  "network_disable_nic_power_saving",
  "network_disable_delivery_optimization",
  "network_tcp_autotuning_normal",
  "network_tcp_rss_enabled",
  "power_ultimate_performance",
  "power_disable_usb_selective_suspend",
  "memory_standby_cleanup",
  "storage_disable_ntfs_last_access",
  "storage_disable_8dot3_and_verify_trim",
  "registry_disable_mouse_accel",
  "input_keyboard_repeat_fast",
  "input_disable_sticky_keys",
  "input_disable_filter_keys",
  "input_disable_toggle_keys",
  "debloat_telemetry_policy",
  "debloat_disable_bing_search",
  "debloat_disable_consumer_features",
  "debloat_disable_activity_history",
];

const MIN_LATENCY_EXTRA_IDS = [
  "gaming_disable_fullscreen_optimizations",
  "gaming_split_svchost_threshold",
  "gpu_enable_hags",
  "gpu_disable_mpo",
  "gpu_msi_mode_display",
  "network_tcp_nodelay",
  "network_tcp_rsc_disabled",
  "network_tcp_ecn_disabled",
  "power_disable_hibernation",
  "power_disable_pcie_aspm",
  "input_disable_usb_hid_idle_suspend",
  "debloat_telemetry_services",
  "debloat_disable_background_uwp_apps",
  "debloat_disable_sysmain_ssd",
];

function riskBadge(risk: TweakRisk): {
  label: string;
  variant: "safe" | "moderate" | "advanced";
} {
  switch (risk) {
    case "safe":
      return { label: "SAFE", variant: "safe" };
    case "moderate":
      return { label: "MODERATE", variant: "moderate" };
    case "advanced":
      return { label: "ADVANCED", variant: "advanced" };
  }
}

function impactLabel(impact: TweakImpact, locale: AppLocale): string {
  switch (impact) {
    case "high":
      return locale === "pt" ? "Alto impacto" : "High impact";
    case "medium":
      return locale === "pt" ? "Médio impacto" : "Medium impact";
    case "low":
      return locale === "pt" ? "Baixo impacto" : "Low impact";
  }
}

export const TweaksView = memo(function TweaksView({
  items,
  selectedIds,
  sessionLabel,
  createRestorePoint = false,
  locale = "pt",
  activeBackupSessions,
  loading,
  busy,
  elevating = false,
  progress,
  lastApplyResult,
  lastRevertResult,
  error,
  diagnostics,
  privilege,
  onRefresh,
  onToggleSelect,
  onSetSelected,
  onSessionLabelChange,
  onCreateRestorePointChange,
  onClearSelection,
  onApplySelected,
  onRevertSingleTweak,
  onRevertAllActive,
  onRequestElevation,
  onInspectBackupSession,
}: TweaksViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);

  const localizedItems = useMemo(
    () => items.map((item) => localizeTweak(item, locale)),
    [items, locale]
  );

  const recommendedIds = useMemo(
    () => new Set(diagnostics.flatMap((d) => d.recommendedTweakIds)),
    [diagnostics]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const hasAdvancedOrSecuritySelected = useMemo(
    () =>
      items.some(
        (item) =>
          selectedSet.has(item.id) &&
          (item.risk === "advanced" || item.category === "security")
      ),
    [items, selectedSet]
  );

  const visibleItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return localizedItems.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) {
        return false;
      }
      if (riskFilter !== "all" && item.risk !== riskFilter) {
        return false;
      }
      if (q.length > 0) {
        const hay =
          `${item.title} ${item.id} ${item.description} ${item.technicalDetail} ${item.benchmarkNote}`.toLowerCase();
        if (!hay.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [localizedItems, categoryFilter, riskFilter, searchQuery]);

  const isPt = locale === "pt";
  const isAdmin = privilege?.isAdmin ?? false;
  const canApply = isAdmin && selectedIds.length > 0 && !busy;
  const canRevertAll = isAdmin && activeBackupSessions.length > 0 && !busy;

  const selectPresetByIds = (targetIds: string[], label: string) => {
    const allowed = new Set(targetIds);
    const matching = items
      .filter((item) => allowed.has(item.id) && item.applicable && !item.applied)
      .map((item) => item.id);
    onSetSelected(matching);
    onSessionLabelChange(label);
  };

  const handleSelectCompetitiveSafe = () => {
    selectPresetByIds(
      COMPETITIVE_SAFE_PRESET_IDS,
      isPt ? "Preset Competitivo (Seguro)" : "Competitive Preset (Safe)"
    );
  };

  const handleSelectMinLatency = () => {
    selectPresetByIds(
      [...COMPETITIVE_SAFE_PRESET_IDS, ...MIN_LATENCY_EXTRA_IDS],
      isPt ? "Preset Latência Mínima" : "Minimum Latency Preset"
    );
  };

  const handleSelectSecurityHardening = () => {
    const secIds = items
      .filter(
        (item) =>
          item.category === "security" &&
          item.risk === "safe" &&
          item.applicable &&
          !item.applied
      )
      .map((item) => item.id);
    onSetSelected(secIds);
    onSessionLabelChange(
      isPt
        ? "Hardening Segurança (CIS/Baseline)"
        : "Security Hardening (CIS/Baseline)"
    );
  };

  const handleApply = () => {
    if (!canApply) return;
    onApplySelected(sessionLabel.trim() || undefined);
  };

  const handleConfirmRevertAll = () => {
    setConfirmRevertAll(false);
    onRevertAllActive();
  };

  const setExpanded = (id: string, open: boolean) => {
    setExpandedIds((prev) => ({ ...prev, [id]: open }));
  };

  const categoryTabs: Array<{
    id: CategoryFilter;
    label: string;
    count: number;
  }> = useMemo(
    () => [
      {
        id: "all",
        label: locale === "pt" ? "Todas" : "All",
        count: items.length,
      },
      ...(Object.keys(CATEGORY_META) as TweakCategory[]).map((cat) => ({
        id: cat,
        label:
          locale === "pt"
            ? CATEGORY_META[cat].labelPt
            : CATEGORY_META[cat].labelEn,
        count: items.filter((item) => item.category === cat).length,
      })),
    ],
    [items, locale]
  );

  const riskTabs: Array<{ id: RiskFilter; label: string }> = [
    { id: "all", label: locale === "pt" ? "Todos" : "All" },
    { id: "safe", label: "SAFE" },
    { id: "moderate", label: "MODERATE" },
    { id: "advanced", label: "ADVANCED" },
  ];

  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, (progress.current / progress.total) * 100)
      : 15;

  return (
    <div className="space-y-4">
      {privilege && !privilege.isAdmin && (
        <Alert variant="warning">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertTitle>
            {isPt
              ? "Sessão sem privilégios de Administrador"
              : "Session without Administrator privileges"}
          </AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="max-w-2xl text-xs">
              {isPt
                ? "Você pode inspecionar chaves e montar presets livremente, mas o backend Rust exige elevação UAC para gravar no Registro, Serviços, TCP/IP ou Energia."
                : "You can inspect keys and build presets freely, but the Rust backend requires UAC elevation to modify Registry keys, Services, TCP/IP, or Power settings."}
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
                  ? "Reiniciar como Administrador"
                  : "Restart as Administrator"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="py-4">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="success"
                size="sm"
                onClick={handleSelectCompetitiveSafe}
                disabled={busy}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>
                  {isPt
                    ? "Preset Competitivo (Seguro)"
                    : "Competitive Preset (Safe)"}
                </span>
              </Button>

              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleSelectMinLatency}
                disabled={busy}
              >
                <Gauge className="size-3.5" aria-hidden="true" />
                <span>{isPt ? "Latência Mínima" : "Minimum Latency"}</span>
              </Button>

              <Button
                type="button"
                variant="neutral"
                size="sm"
                onClick={handleSelectSecurityHardening}
                disabled={busy}
              >
                <Shield className="size-3.5" aria-hidden="true" />
                <span>
                  {isPt ? "Hardening Segurança" : "Security Hardening"}
                </span>
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {confirmRevertAll ? (
                <div className="inline-flex flex-wrap items-center gap-2 rounded-base border-2 border-border bg-chart-3 px-3 py-1.5 text-main-foreground">
                  <span className="font-heading text-xs font-bold">
                    {isPt
                      ? `Reverter ${activeBackupSessions.length} sessão(ões) ativa(s)?`
                      : `Revert ${activeBackupSessions.length} active session(s)?`}
                  </span>
                  <Button
                    type="button"
                    variant="neutral"
                    size="xs"
                    onClick={() => setConfirmRevertAll(false)}
                    disabled={busy}
                  >
                    {isPt ? "Cancelar" : "Cancel"}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    onClick={handleConfirmRevertAll}
                    disabled={!canRevertAll}
                  >
                    {isPt ? "Confirmar" : "Confirm"}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="neutral"
                  size="sm"
                  onClick={() => setConfirmRevertAll(true)}
                  disabled={!canRevertAll}
                  title={
                    activeBackupSessions.length === 0
                      ? isPt
                        ? "Nenhuma sessão de backup ativa para reverter"
                        : "No active backup sessions to revert"
                      : !isAdmin
                        ? isPt
                          ? "Requer execução como Administrador"
                          : "Requires Administrator privileges"
                        : isPt
                          ? "Reverter todas as sessões de backup ativas em ordem inversa"
                          : "Revert all active backup sessions in reverse order"
                  }
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  <span>
                    {isPt ? "Reverter Tudo" : "Revert All"}
                    {activeBackupSessions.length > 0
                      ? ` (${activeBackupSessions.length})`
                      : ""}
                  </span>
                </Button>
              )}

              <Button
                type="button"
                variant="neutral"
                size="icon-sm"
                onClick={onRefresh}
                disabled={loading || busy}
                aria-label={
                  isPt
                    ? "Revalidar estado atual do sistema"
                    : "Revalidate current system state"
                }
                title={
                  isPt
                    ? "Revalidar estado atual do sistema"
                    : "Revalidate current system state"
                }
              >
                <RefreshCw
                  className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t-2 border-border pt-3.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <Badge
                variant={selectedIds.length > 0 ? "default" : "neutral"}
                className="nb-mono"
              >
                {selectedIds.length} {isPt ? "selecionado(s)" : "selected"}
              </Badge>
              {selectedIds.length > 0 && (
                <Button
                  type="button"
                  variant="neutral"
                  size="xs"
                  onClick={onClearSelection}
                  disabled={busy}
                >
                  {isPt ? "Limpar seleção" : "Clear selection"}
                </Button>
              )}

              {onCreateRestorePointChange && (
                <div className="inline-flex items-center gap-2 rounded-base border-2 border-border bg-background px-2.5 py-1">
                  <Checkbox
                    checked={createRestorePoint}
                    disabled={busy}
                    onCheckedChange={onCreateRestorePointChange}
                    aria-label={
                      isPt
                        ? "Criar Ponto de Restauração do Windows (VSS)"
                        : "Create Windows System Restore Point (VSS)"
                    }
                  />
                  <span className="font-heading text-xs font-bold">
                    {isPt
                      ? "Ponto de Restauração (VSS)"
                      : "Windows Restore Point (VSS)"}
                  </span>
                  {hasAdvancedOrSecuritySelected && (
                    <Badge variant="moderate">
                      {isPt ? "Recomendado" : "Suggested"}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                type="text"
                value={sessionLabel}
                onChange={(e) => onSessionLabelChange(e.target.value)}
                placeholder={
                  isPt
                    ? "Rótulo opcional do backup (ex: Perfil Competitivo)"
                    : "Optional backup label (e.g. Competitive Profile)"
                }
                disabled={busy}
                aria-label={
                  isPt
                    ? "Rótulo opcional do snapshot de backup"
                    : "Optional backup snapshot label"
                }
                className="h-9 w-72 text-xs"
              />

              <Button
                type="button"
                variant={canApply ? "success" : "neutral"}
                size="sm"
                onClick={handleApply}
                disabled={!canApply}
              >
                {busy ? (
                  <>
                    <RefreshCw
                      className="size-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    <span>{isPt ? "Executando..." : "Applying..."}</span>
                  </>
                ) : (
                  <>
                    <Rocket className="size-3.5" aria-hidden="true" />
                    <span>
                      {isPt
                        ? `Aplicar com backup (${selectedIds.length})`
                        : `Apply with backup (${selectedIds.length})`}
                    </span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {busy && progress && (
            <div className="space-y-2 rounded-base border-2 border-border bg-background p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="nb-mono font-bold">{progress.message}</span>
                <span className="nb-mono font-bold">
                  {progress.current}/{progress.total}
                </span>
              </div>
              <Progress value={progressPct} />
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {isPt ? "Erro" : "Error"} [{error.code}]
          </AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {lastApplyResult && (
        <Alert
          variant={
            lastApplyResult.failures.length === 0 ? "success" : "warning"
          }
        >
          {lastApplyResult.failures.length === 0 ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {isPt
              ? `${lastApplyResult.appliedIds.length} tweak(s) aplicados${
                  lastApplyResult.failures.length > 0
                    ? ` · ${lastApplyResult.failures.length} falha(s)`
                    : " com snapshot atômico salvo"
                }${
                  lastApplyResult.restorePointCreated
                    ? " + Ponto de Restauração VSS criado"
                    : ""
                }`
              : `${lastApplyResult.appliedIds.length} tweak(s) applied${
                  lastApplyResult.failures.length > 0
                    ? ` · ${lastApplyResult.failures.length} failure(s)`
                    : " with atomic snapshot saved"
                }${
                  lastApplyResult.restorePointCreated
                    ? " + VSS Restore Point created"
                    : ""
                }`}
          </AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 text-xs">
              {lastApplyResult.backupPath && (
                <div className="nb-mono break-all">
                  Backup: {lastApplyResult.backupPath}
                </div>
              )}
              {lastApplyResult.restorePointWarning && (
                <div className="font-medium">
                  {lastApplyResult.restorePointWarning}
                </div>
              )}
              {lastApplyResult.failures.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-1 pl-4">
                  {lastApplyResult.failures.map((f) => (
                    <li key={f.tweakId}>
                      <span className="font-bold">
                        {localizeTweakTitle(f.tweakId, f.tweakTitle, locale)}:
                      </span>{" "}
                      {f.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {lastApplyResult.sessionId &&
              lastApplyResult.backupPath &&
              lastApplyResult.appliedIds.length > 0 && (
                <Button
                  type="button"
                  variant="neutral"
                  size="xs"
                  onClick={() =>
                    onInspectBackupSession(lastApplyResult.sessionId)
                  }
                >
                  <History className="size-3.5" aria-hidden="true" />
                  <span>{isPt ? "Inspecionar backup" : "Inspect backup"}</span>
                </Button>
              )}
          </AlertDescription>
        </Alert>
      )}

      {lastRevertResult && (
        <Alert
          variant={
            lastRevertResult.failures.length === 0 ? "success" : "warning"
          }
        >
          {lastRevertResult.failures.length === 0 ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {isPt
              ? `Reversão concluída: ${lastRevertResult.revertedCount} tweak(s) restaurados (${lastRevertResult.sessionId})`
              : `Rollback completed: ${lastRevertResult.revertedCount} tweak(s) restored (${lastRevertResult.sessionId
                  .replace("sessões (interrompido)", "sessions (interrupted)")
                  .replace("sessões", "sessions")})`}
          </AlertTitle>
          {lastRevertResult.failures.length > 0 && (
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {lastRevertResult.failures.map((f) => (
                  <li key={f.tweakId}>
                    <span className="font-bold">
                      {localizeTweakTitle(f.tweakId, f.tweakTitle, locale)}:
                    </span>{" "}
                    {f.error}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground/60"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isPt
                ? "Buscar tweak, chave do Registro, netsh, fsutil..."
                : "Search tweak, Registry key, netsh, fsutil..."
            }
            aria-label={isPt ? "Buscar tweaks" : "Search tweaks"}
            className="h-10 pr-9 pl-9 text-xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label={isPt ? "Limpar busca" : "Clear search"}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-foreground/65 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="neutral" className="nb-mono">
            {visibleItems.length} / {items.length}
          </Badge>

          <div
            role="group"
            aria-label={
              isPt ? "Filtrar por nível de risco" : "Filter by risk level"
            }
            className="inline-flex flex-wrap items-center gap-1 rounded-base border-2 border-border bg-secondary-background p-1 shadow-shadow"
          >
            {riskTabs.map((tab) => {
              const active = riskFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRiskFilter(tab.id)}
                  className={`nb-mono inline-flex cursor-pointer items-center justify-center rounded-base border-2 px-3 py-1 text-xs font-heading font-bold transition-colors ${
                    active
                      ? "border-border bg-main text-main-foreground"
                      : "border-transparent bg-transparent text-foreground hover:bg-background"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        role="group"
        aria-label={isPt ? "Categorias de tweaks" : "Tweak categories"}
        className="flex flex-wrap items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background p-1.5 shadow-shadow"
      >
        {categoryTabs.map((tab) => {
          const active = categoryFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => setCategoryFilter(tab.id)}
              className={`inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-base border-2 px-3 py-1.5 text-xs font-heading font-bold transition-colors ${
                active
                  ? "border-border bg-main text-main-foreground"
                  : "border-transparent bg-transparent text-foreground hover:bg-background"
              }`}
            >
              <span>{tab.label}</span>
              <span className="nb-mono rounded border border-border bg-secondary-background px-1.5 py-0 text-[10.5px] text-foreground">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && items.length === 0 ? (
        <Card>
          <CardContent className="nb-mono text-xs font-bold">
            {isPt
              ? "Lendo estado do Registro, Serviços, TCP/IP e Energia..."
              : "Reading Registry, Services, TCP/IP, and Power state..."}
          </CardContent>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm font-medium text-foreground/75">
            {isPt
              ? "Nenhum tweak encontrado para os filtros aplicados."
              : "No tweaks found for the active filters."}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y-2 divide-border">
            {visibleItems.map((item) => {
              const isSelected = selectedSet.has(item.id);
              const isRecommended = recommendedIds.has(item.id);
              const isExpanded = Boolean(expandedIds[item.id]);
              const catMeta = CATEGORY_META[item.category];
              const CatIcon = catMeta.icon;
              const catLabel =
                locale === "pt" ? catMeta.labelPt : catMeta.labelEn;
              const risk = riskBadge(item.risk);

              return (
                <Collapsible
                  key={item.id}
                  open={isExpanded}
                  onOpenChange={(open) => setExpanded(item.id, open)}
                  className={`transition-colors ${
                    isSelected
                      ? "bg-main/15"
                      : "bg-secondary-background hover:bg-background/60"
                  } ${!item.applicable ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start gap-3.5 px-5 py-4">
                    <div className="pt-0.5">
                      <Checkbox
                        checked={isSelected}
                        disabled={busy || !item.applicable}
                        onCheckedChange={() => onToggleSelect(item.id)}
                        aria-label={
                          isPt
                            ? `Selecionar ${item.title}`
                            : `Select ${item.title}`
                        }
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy || !item.applicable}
                            onClick={() => onToggleSelect(item.id)}
                            className="cursor-pointer text-left font-heading text-sm font-bold hover:underline disabled:cursor-not-allowed"
                          >
                            {item.title}
                          </button>

                          <Badge variant={item.applied ? "safe" : "neutral"}>
                            {item.applied
                              ? locale === "pt"
                                ? "Aplicado"
                                : "Applied"
                              : locale === "pt"
                                ? "Disponível"
                                : "Available"}
                          </Badge>

                          {isRecommended && !item.applied && (
                            <Badge variant="default">
                              {locale === "pt" ? "Recomendado" : "Recommended"}
                            </Badge>
                          )}

                          <Badge variant={risk.variant} className="nb-mono">
                            {risk.label}
                          </Badge>

                          {REBOOT_REQUIRED_TWEAK_IDS.has(item.id) && (
                            <Badge variant="moderate" className="nb-mono">
                              REBOOT
                            </Badge>
                          )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {item.applied &&
                            item.reversible &&
                            onRevertSingleTweak &&
                            activeBackupSessions.length > 0 && (
                              <Button
                                type="button"
                                variant="neutral"
                                size="xs"
                                disabled={!isAdmin || busy}
                                onClick={() => onRevertSingleTweak(item.id)}
                                title={
                                  locale === "pt"
                                    ? "Reverter este tweak a partir do snapshot mais recente"
                                    : "Revert this tweak from the most recent active snapshot"
                                }
                              >
                                <RotateCcw
                                  className="size-3"
                                  aria-hidden="true"
                                />
                                <span>
                                  {locale === "pt" ? "Reverter" : "Revert"}
                                </span>
                              </Button>
                            )}

                          <CollapsibleTrigger className="inline-flex shrink-0 items-center gap-1 rounded-base border-2 border-border bg-background px-2.5 py-1 text-xs font-heading font-bold transition-colors hover:bg-main hover:text-main-foreground">
                            <Terminal className="size-3.5" aria-hidden="true" />
                            <span>{isPt ? "Detalhes" : "Details"}</span>
                            <ChevronDown
                              className={`size-3.5 transition-transform duration-150 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              aria-hidden="true"
                            />
                          </CollapsibleTrigger>
                        </div>
                      </div>

                      <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-foreground/80">
                        {item.description}
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-foreground/75">
                        <span className="inline-flex items-center gap-1 font-heading font-bold">
                          <CatIcon className="size-3.5" aria-hidden="true" />
                          {catLabel}
                        </span>
                        <span className="font-heading font-bold">
                          {impactLabel(item.impact, locale)}
                        </span>
                        {item.hardwareNote && (
                          <span className="text-foreground/85">
                            {item.hardwareNote}
                          </span>
                        )}
                        {!item.applicable && (
                          <Badge variant="moderate">
                            {isPt
                              ? "Indisponível neste hardware/OS"
                              : "Unavailable on this hardware/OS"}
                          </Badge>
                        )}
                      </div>

                      <CollapsibleContent>
                        <div className="mt-3 space-y-2.5 rounded-base border-2 border-border bg-background p-3.5 text-xs">
                          <div>
                            <div className="font-heading text-[11px] font-bold uppercase text-foreground/70">
                              {isPt
                                ? "Chave do Registro / Comando / API Win32"
                                : "Registry Key / Command / Win32 API"}
                            </div>
                            <pre className="nb-mono mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-base border-2 border-border bg-secondary-background p-2.5 text-[11px] leading-relaxed">
                              {item.technicalDetail}
                            </pre>
                          </div>

                          <div>
                            <div className="font-heading text-[11px] font-bold uppercase text-foreground/70">
                              {isPt
                                ? "Evidência técnica / Benchmark"
                                : "Technical Evidence / Benchmark"}
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-foreground/85">
                              {item.benchmarkNote}
                            </p>
                          </div>

                          <div className="nb-mono flex flex-wrap gap-x-4 gap-y-1 border-t-2 border-border pt-2 text-[11px] text-foreground/75">
                            <span>ID: {item.id}</span>
                            <span>
                              {isPt ? "Privilégio:" : "Privilege:"}{" "}
                              {item.requiresAdmin
                                ? isPt
                                  ? "Administrador"
                                  : "Administrator"
                                : isPt
                                  ? "Usuário"
                                  : "Standard User"}
                            </span>
                            <span>
                              {isPt ? "Reversível:" : "Reversible:"}{" "}
                              {item.reversible
                                ? isPt
                                  ? "Sim (Backup atômico)"
                                  : "Yes (Atomic backup)"
                                : isPt
                                  ? "Não"
                                  : "No"}
                            </span>
                          </div>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </div>
                </Collapsible>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
});
