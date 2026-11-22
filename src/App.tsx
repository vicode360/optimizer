import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { BackupsView } from "./components/BackupsView";
import { CommandPalette } from "./components/CommandPalette";
import { DiagnosticsView } from "./components/DiagnosticsView";
import { HardwareView } from "./components/HardwareView";
import { NetLabView } from "./components/NetLabView";
import { Sidebar } from "./components/Sidebar";
import { StartupView } from "./components/StartupView";
import { TelemetryView } from "./components/TelemetryView";
import { TopBar } from "./components/TopBar";
import { TweaksView } from "./components/TweaksView";
import { UpdateModal } from "./components/UpdateModal";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { useBackups } from "./hooks/useBackups";
import { usePrivilegeStatus } from "./hooks/usePrivilegeStatus";
import { useSystemScan } from "./hooks/useSystemScan";
import { useTelemetry } from "./hooks/useTelemetry";
import { useTweaks } from "./hooks/useTweaks";
import { isTauriRuntime, normalizeAppError, tauriClient } from "./services/tauriClient";
import type {
  ActiveSection,
  AppError,
  AppLocale,
  DiagnosticFinding,
  UpdateCheckResult,
} from "./types/system";
import { formatBytes } from "./utils/format";

const THEME_STORAGE_KEY = "optimizer-theme";
const LOCALE_STORAGE_KEY = "optimizer-locale";
const IGNORED_RELEASE_KEY = "optimizer-ignored-release";
const EMPTY_DIAGNOSTICS: DiagnosticFinding[] = [];

function readInitialTheme(): "light" | "dark" {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function readInitialLocale(): AppLocale {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) === "en"
      ? "en"
      : "pt";
  } catch {
    return "pt";
  }
}

export function App() {
  const [activeSection, setActiveSection] =
    useState<ActiveSection>("diagnostics");
  const [theme, setTheme] = useState<"light" | "dark">(readInitialTheme);
  const [locale, setLocale] = useState<AppLocale>(readInitialLocale);
  const [elevationError, setElevationError] = useState<AppError | null>(null);
  const [elevating, setElevating] = useState(false);
  const elevatingRef = useRef(false);

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [updateError, setUpdateError] = useState<AppError | null>(null);

  const {
    privilege,
    loading: privilegeLoading,
    error: privilegeError,
  } = usePrivilegeStatus();
  const { report, scanning, error: scanError, runScan } = useSystemScan();
  const backups = useBackups();
  const telemetry = useTelemetry();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage persistence errors.
    }
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en-US" : "pt-BR";
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Ignore storage persistence errors.
    }
  }, [locale]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      } else if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleCheckUpdates = useCallback(async (openIfFoundOnly = false) => {
    if (!isTauriRuntime() && openIfFoundOnly) return;
    setCheckingUpdates(true);
    setUpdateError(null);
    if (!openIfFoundOnly) {
      setUpdateModalOpen(true);
    }
    try {
      const info = await tauriClient.checkGithubUpdates();
      setUpdateInfo(info);
      if (openIfFoundOnly && info.updateAvailable) {
        let ignoredTag: string | null = null;
        try {
          ignoredTag = window.localStorage.getItem(IGNORED_RELEASE_KEY);
        } catch {
          // Ignore storage read errors.
        }
        if (ignoredTag !== info.releaseTag) {
          setUpdateModalOpen(true);
        }
      }
    } catch (err) {
      if (!openIfFoundOnly) {
        setUpdateError(normalizeAppError(err));
      }
    } finally {
      setCheckingUpdates(false);
    }
  }, []);

  useEffect(() => {
    void handleCheckUpdates(true);
  }, [handleCheckUpdates]);

  const handleIgnoreVersion = useCallback((tag: string) => {
    try {
      window.localStorage.setItem(IGNORED_RELEASE_KEY, tag);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const handleToggleLocale = useCallback(() => {
    setLocale((prev) => (prev === "pt" ? "en" : "pt"));
  }, []);

  const handleMutationComplete = useCallback(async () => {
    await Promise.all([backups.refresh(), runScan()]);
  }, [backups, runScan]);

  const tweaks = useTweaks({
    onMutationComplete: handleMutationComplete,
  });

  const handleExportReport = useCallback(() => {
    const applied = tweaks.items.filter((t) => t.applied);
    const lines = [
      `# Optimizer — Technical System Audit Report`,
      `Generated at: ${new Date().toISOString()}`,
      ``,
      `## Hardware Summary`,
      `- **Host / OS:** ${report?.hardware.os.hostname ?? "—"} (${report?.hardware.os.name ?? ""} ${report?.hardware.os.version ?? ""})`,
      `- **CPU:** ${report?.hardware.cpu.brand ?? "—"} (${report?.hardware.cpu.physicalCores ?? 0}C / ${report?.hardware.cpu.logicalCores ?? 0}T)`,
      `- **Memory:** ${formatBytes(report?.hardware.memory.usedBytes ?? 0)} / ${formatBytes(report?.hardware.memory.totalBytes ?? 0)}`,
      `- **Active Power Plan:** ${report?.hardware.powerPlan.name ?? "—"}`,
      `- **GPUs:** ${(report?.hardware.gpus ?? []).map((g) => `${g.name} (${formatBytes(g.vramBytes)})`).join(", ") || "—"}`,
      ``,
      `## Applied Optimizations (${applied.length}/${tweaks.items.length})`,
      ...applied.map((t) => `- \`${t.id}\` — **${t.title}** (${t.risk.toUpperCase()})`),
      ``,
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `optimizer-audit-report.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [report, tweaks.items]);

  const handleRequestElevation = useCallback(() => {
    if (elevatingRef.current) return;
    elevatingRef.current = true;
    setElevating(true);
    setElevationError(null);
    void tauriClient
      .requestAdminElevation()
      .catch((err) => {
        setElevationError(normalizeAppError(err));
      })
      .finally(() => {
        elevatingRef.current = false;
        setElevating(false);
      });
  }, []);

  const handleRunScan = useCallback(() => {
    void runScan();
  }, [runScan]);

  const handleRefreshBackups = useCallback(() => {
    void backups.refresh();
  }, [backups]);

  const handleInspectSession = useCallback(
    (sessionId: string) => {
      void backups.inspectSession(sessionId);
    },
    [backups]
  );

  const handleInspectBackupFromTweaks = useCallback(
    (sessionId: string) => {
      setActiveSection("backups");
      void backups.inspectSession(sessionId);
    },
    [backups]
  );

  const handleRevertSession = useCallback(
    (sessionId: string) => {
      void tweaks.revertSession(sessionId);
    },
    [tweaks]
  );

  const handleRevertSingleTweak = useCallback(
    (tweakId: string, sessionId?: string) => {
      void tweaks.revertSingleTweak(tweakId, sessionId);
    },
    [tweaks]
  );

  const activeBackupSessions = useMemo(
    () => backups.sessions.filter((s) => s.restoredAt === null),
    [backups.sessions]
  );

  const handleRevertAllActive = useCallback(() => {
    const ids = activeBackupSessions.map((s) => s.sessionId);
    if (ids.length === 0) return;
    void tweaks.revertAllSessions(ids);
  }, [activeBackupSessions, tweaks]);

  const handleRefreshTweaks = useCallback(() => {
    void tweaks.refresh();
  }, [tweaks]);

  const handleApplySelected = useCallback(
    (label?: string) => {
      void tweaks.applySelected(label);
    },
    [tweaks]
  );

  const handleOpenTweaks = useCallback(() => {
    setActiveSection("tweaks");
  }, []);

  const handleOpenUpdatesManual = useCallback(() => {
    void handleCheckUpdates(false);
  }, [handleCheckUpdates]);

  const handleOpenCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true);
  }, []);

  const pendingRecommendedIds = useMemo(() => {
    const recommendedIds = new Set(
      (report?.diagnostics ?? []).flatMap((d) => d.recommendedTweakIds)
    );
    return tweaks.items
      .filter(
        (item) =>
          recommendedIds.has(item.id) && item.applicable && !item.applied
      )
      .map((item) => item.id);
  }, [report, tweaks.items]);

  const handleQuickOptimize = useCallback(() => {
    if (!tweaks.busy && pendingRecommendedIds.length > 0) {
      tweaks.setSelected(pendingRecommendedIds);
    }
    setActiveSection("tweaks");
  }, [pendingRecommendedIds, tweaks]);

  const alertCount = useMemo(
    () =>
      report?.diagnostics.filter(
        (item) => item.severity === "critical" || item.severity === "warning"
      ).length ?? 0,
    [report]
  );

  const appliedTweaksCount = useMemo(
    () => tweaks.items.filter((t) => t.applied).length,
    [tweaks.items]
  );

  const diagnosticsList = report?.diagnostics ?? EMPTY_DIAGNOSTICS;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        locale={locale}
        privilege={privilege}
        privilegeLoading={privilegeLoading}
        elevating={elevating}
        alertCount={alertCount}
        backupCount={backups.sessions.length}
        appliedTweaksCount={appliedTweaksCount}
        totalTweaksCount={tweaks.items.length}
        telemetryConnected={telemetry.connected}
        updateAvailable={Boolean(updateInfo?.updateAvailable)}
        onRequestElevation={handleRequestElevation}
        onOpenUpdates={handleOpenUpdatesManual}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          activeSection={activeSection}
          scannedAt={report?.scannedAt ?? null}
          scanning={scanning}
          onRunScan={handleRunScan}
          telemetryConnected={telemetry.connected}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          locale={locale}
          onToggleLocale={handleToggleLocale}
          updateAvailable={Boolean(updateInfo?.updateAvailable)}
          onOpenUpdates={handleOpenUpdatesManual}
          onOpenCommandPalette={handleOpenCommandPalette}
          onExportReport={handleExportReport}
        />

        <main className="min-h-0 flex-1 overflow-y-auto bg-background px-6 py-6">
          <div className="mx-auto max-w-6xl space-y-5">
            {elevationError && (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>Erro de elevação [{elevationError.code}]</AlertTitle>
                <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
                  <span>{elevationError.message}</span>
                  <Button
                    type="button"
                    variant="neutral"
                    size="xs"
                    onClick={() => setElevationError(null)}
                  >
                    Fechar
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {privilegeError && (
              <Alert variant="warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <AlertTitle>
                  Falha ao consultar privilégio Win32 [{privilegeError.code}]
                </AlertTitle>
                <AlertDescription>{privilegeError.message}</AlertDescription>
              </Alert>
            )}

            {activeSection === "diagnostics" && (
              <ScanGate
                scanning={scanning}
                errorMessage={scanError?.message ?? null}
                errorCode={scanError?.code ?? null}
                hasReport={report !== null}
                onRetry={handleRunScan}
              >
                {report && (
                  <DiagnosticsView
                    report={report}
                    telemetry={telemetry.latest}
                    scanning={scanning}
                    locale={locale}
                    pendingRecommendedCount={pendingRecommendedIds.length}
                    onOpenTweaks={handleOpenTweaks}
                    onQuickOptimize={handleQuickOptimize}
                  />
                )}
              </ScanGate>
            )}

            {activeSection === "netlab" && (
              <NetLabView
                locale={locale}
                privilege={privilege}
                elevating={elevating}
                onRequestElevation={handleRequestElevation}
                onMutationComplete={handleMutationComplete}
              />
            )}

            {activeSection === "hardware" && (
              <ScanGate
                scanning={scanning}
                errorMessage={scanError?.message ?? null}
                errorCode={scanError?.code ?? null}
                hasReport={report !== null}
                onRetry={handleRunScan}
              >
                {report && (
                  <HardwareView report={report} scanning={scanning} />
                )}
              </ScanGate>
            )}

            {activeSection === "telemetry" && (
              <TelemetryView
                latest={telemetry.latest}
                history={telemetry.history}
              />
            )}

            {activeSection === "startup" && (
              <StartupView
                locale={locale}
                privilege={privilege}
                elevating={elevating}
                onRequestElevation={handleRequestElevation}
                onMutationComplete={handleMutationComplete}
              />
            )}

            {activeSection === "backups" && (
              <BackupsView
                directory={backups.directory}
                sessions={backups.sessions}
                selectedSession={backups.selectedSession}
                loading={backups.loading}
                loadingSession={backups.loadingSession}
                busy={tweaks.busy}
                elevating={elevating}
                locale={locale}
                progress={tweaks.progress}
                lastRevertResult={tweaks.lastRevertResult}
                error={backups.error ?? tweaks.error}
                privilege={privilege}
                privilegeLoading={privilegeLoading}
                onRefresh={handleRefreshBackups}
                onInspectSession={handleInspectSession}
                onRevertSession={handleRevertSession}
                onRevertSingleTweak={handleRevertSingleTweak}
                onRequestElevation={handleRequestElevation}
              />
            )}

            {activeSection === "tweaks" && (
              <TweaksView
                items={tweaks.items}
                selectedIds={tweaks.selectedIds}
                sessionLabel={tweaks.sessionLabel}
                createRestorePoint={tweaks.createRestorePoint}
                locale={locale}
                activeBackupSessions={activeBackupSessions}
                loading={tweaks.loading}
                busy={tweaks.busy}
                elevating={elevating}
                progress={tweaks.progress}
                lastApplyResult={tweaks.lastApplyResult}
                lastRevertResult={tweaks.lastRevertResult}
                error={tweaks.error}
                diagnostics={diagnosticsList}
                privilege={privilege}
                onRefresh={handleRefreshTweaks}
                onToggleSelect={tweaks.toggleSelect}
                onSetSelected={tweaks.setSelected}
                onSessionLabelChange={tweaks.setSessionLabel}
                onCreateRestorePointChange={tweaks.setCreateRestorePoint}
                onClearSelection={tweaks.clearSelection}
                onApplySelected={handleApplySelected}
                onRevertSingleTweak={handleRevertSingleTweak}
                onRevertAllActive={handleRevertAllActive}
                onRequestElevation={handleRequestElevation}
                onInspectBackupSession={handleInspectBackupFromTweaks}
              />
            )}
          </div>
        </main>
      </div>

      <UpdateModal
        open={updateModalOpen}
        locale={locale}
        checking={checkingUpdates}
        updateInfo={updateInfo}
        checkError={updateError}
        onClose={() => setUpdateModalOpen(false)}
        onRecheck={handleOpenUpdatesManual}
        onIgnoreVersion={handleIgnoreVersion}
      />

      <CommandPalette
        open={commandPaletteOpen}
        locale={locale}
        theme={theme}
        tweaks={tweaks.items}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={setActiveSection}
        onSelectTweak={tweaks.toggleSelect}
        onToggleTheme={handleToggleTheme}
        onToggleLocale={handleToggleLocale}
        onOpenUpdates={handleOpenUpdatesManual}
        onRunScan={handleRunScan}
        onExportReport={handleExportReport}
      />
    </div>
  );
}

function ScanGate({
  scanning,
  errorMessage,
  errorCode,
  hasReport,
  onRetry,
  children,
}: {
  scanning: boolean;
  errorMessage: string | null;
  errorCode: string | null;
  hasReport: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  if (scanning && !hasReport) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
            <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          </div>
          <div>
            <div className="font-heading text-sm font-bold">
              Coletando inventário do sistema...
            </div>
            <p className="nb-mono text-xs text-foreground/70">
              Lendo hardware, periféricos, Registro e planos de energia via Rust
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (errorMessage && !hasReport) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" aria-hidden="true" />
        <AlertTitle>Falha ao ler dados do sistema</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {errorCode && (
              <span className="nb-mono mr-1.5 font-bold">[{errorCode}]</span>
            )}
            {errorMessage}
          </p>
          <Button type="button" variant="neutral" size="sm" onClick={onRetry}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            <span>Tentar novamente</span>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      {errorMessage && hasReport && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Falha ao atualizar varredura do sistema</AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
            <span>
              {errorCode && (
                <span className="nb-mono mr-1.5 font-bold">[{errorCode}]</span>
              )}
              {errorMessage}
            </span>
            <Button type="button" variant="neutral" size="xs" onClick={onRetry}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>Tentar novamente</span>
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {children}
    </>
  );
}
