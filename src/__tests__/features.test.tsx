import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkPanel } from "../components/BenchmarkPanel";
import { CommandPalette } from "../components/CommandPalette";
import { NetLabView } from "../components/NetLabView";
import { Sidebar } from "../components/Sidebar";
import { StartupView } from "../components/StartupView";
import { TopBar } from "../components/TopBar";
import { TweaksView } from "../components/TweaksView";
import { UpdateModal } from "../components/UpdateModal";
import { localizeDiagnostic, localizeTweak } from "../i18n";
import { tauriClient } from "../services/tauriClient";
import type { DiagnosticFinding, TweakItem } from "../types/system";

vi.mock("../services/tauriClient", () => ({
  normalizeAppError: (err: unknown) => ({
    code: "INVALID_OPERATION",
    message: err instanceof Error ? err.message : String(err),
    detail: null,
  }),
  tauriClient: {
    runSystemBenchmark: vi.fn(),
    listStartupItems: vi.fn(),
    setStartupItemEnabled: vi.fn(),
    listQosPolicies: vi.fn(),
    listNicDriverTweaks: vi.fn(),
    probeGameRoutes: vi.fn(),
    traceRouteHops: vi.fn(),
    getCurrentDnsStatus: vi.fn(),
    runMultiDnsBenchmark: vi.fn(),
    applyCustomDnsProvider: vi.fn(),
    discoverOptimalMtu: vi.fn(),
    applyOptimalMtu: vi.fn(),
    addQosGamePolicy: vi.fn(),
    removeQosGamePolicy: vi.fn(),
    applyNicDriverTweak: vi.fn(),
    flushNetworkStack: vi.fn(),
    downloadAndLaunchUpdate: vi.fn(),
  },
}));

const mockedClient = vi.mocked(tauriClient);

describe("New features: i18n, BenchmarkPanel, StartupView, NetLabView, UpdateModal & CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockedClient.listQosPolicies.mockResolvedValue([]);
    mockedClient.listNicDriverTweaks.mockResolvedValue([]);
    mockedClient.getCurrentDnsStatus.mockResolvedValue({
      interfaceAlias: "Ethernet",
      servers: ["192.168.1.1"],
      isDhcp: true,
      matchedProviderId: null,
      matchedProviderName: null,
    });
  });

  it("localizes tweaks and diagnostics between PT-BR and EN-US while preserving IDs", () => {
    const sampleTweak: TweakItem = {
      id: "registry_mmcss_gaming",
      title: "Prioridade MMCSS",
      description: "Descrição em português",
      technicalDetail: "HKLM\\...",
      benchmarkNote: "Nota em português",
      category: "gaming",
      impact: "high",
      risk: "safe",
      requiresAdmin: true,
      reversible: true,
      applied: false,
      applicable: true,
      hardwareNote: null,
    };

    const pt = localizeTweak(sampleTweak, "pt");
    expect(pt.title).toBe("Prioridade MMCSS");

    const en = localizeTweak(sampleTweak, "en");
    expect(en.id).toBe("registry_mmcss_gaming");
    expect(en.title).toContain("MMCSS Gaming");

    const diag: DiagnosticFinding = {
      id: "diag_power_plan",
      title: "Plano de energia pode limitar boost",
      detail: "Detalhe PT",
      severity: "warning",
      recommendedTweakIds: ["power_ultimate_performance"],
    };
    expect(localizeDiagnostic(diag, "en").title).toContain(
      "Active power plan may throttle"
    );
  });

  it("captures Before/After benchmark snapshots and calculates real deltas", async () => {
    const user = userEvent.setup();

    mockedClient.runSystemBenchmark
      .mockResolvedValueOnce({
        capturedAt: "2026-01-10T10:00:00Z",
        timerAvgMs: 1.85,
        timerP95Ms: 2.1,
        timerJitterMs: 0.75,
        dnsLatencyMs: 28.4,
        primaryDnsServer: "192.168.1.1",
        memoryAvailableBytes: 6 * 1024 * 1024 * 1024,
        memoryUsedBytes: 10 * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        memoryPercent: 62.5,
        powerPlanName: "Balanced",
        tcpAutotuning: "normal",
        tcpRss: "enabled",
        tcpRsc: "enabled",
        tcpCongestionProvider: "cubic",
      })
      .mockResolvedValueOnce({
        capturedAt: "2026-01-10T10:05:00Z",
        timerAvgMs: 1.05,
        timerP95Ms: 1.15,
        timerJitterMs: 0.15,
        dnsLatencyMs: 11.2,
        primaryDnsServer: "1.1.1.1",
        memoryAvailableBytes: 8 * 1024 * 1024 * 1024,
        memoryUsedBytes: 8 * 1024 * 1024 * 1024,
        memoryTotalBytes: 16 * 1024 * 1024 * 1024,
        memoryPercent: 50.0,
        powerPlanName: "Ultimate Performance",
        tcpAutotuning: "normal",
        tcpRss: "enabled",
        tcpRsc: "disabled",
        tcpCongestionProvider: "bbr2",
      });

    render(<BenchmarkPanel locale="en" />);

    await user.click(
      screen.getByRole("button", { name: /Capture Baseline \(Before\)/i })
    );
    expect(await screen.findByText("1.85 ms")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Measure Now \(After\)/i })
    );
    expect(await screen.findByText("-0.80 ms")).toBeInTheDocument();
    expect(screen.getByText("+2.0 GiB")).toBeInTheDocument();
  });

  it("lists and toggles Startup & Scheduled Task items with atomic backup", async () => {
    const user = userEvent.setup();
    const onMutationComplete = vi.fn();

    mockedClient.listStartupItems.mockResolvedValue([
      {
        id: "hkcu_run::Discord",
        name: "Discord",
        commandOrPath: "C:\\Users\\test\\AppData\\Local\\Discord\\Update.exe",
        locationLabel: "HKCU :: Run (Usuário Atual)",
        source: "hkcuRun",
        enabled: true,
        requiresAdmin: false,
      },
    ]);
    mockedClient.setStartupItemEnabled.mockResolvedValue({
      id: "hkcu_run::Discord",
      enabled: false,
      backupSessionId: "sess-startup-1",
    });

    render(
      <StartupView
        locale="pt"
        privilege={{
          isAdmin: true,
          elevationLabel: "Administrador",
          username: "tester",
        }}
        elevating={false}
        onRequestElevation={vi.fn()}
        onMutationComplete={onMutationComplete}
      />
    );

    await waitFor(() => expect(screen.getByText("Discord")).toBeInTheDocument());

    const disableButtons = screen.getAllByRole("button", {
      name: /Desativar/i,
    });
    await user.click(disableButtons[0]);

    expect(mockedClient.setStartupItemEnabled).toHaveBeenCalledWith(
      "hkcu_run::Discord",
      false
    );
    expect(onMutationComplete).toHaveBeenCalledTimes(1);
  });

  it("operates NetLabView: probes regional game routes, runs Multi-DNS benchmark, discovers optimal MTU, and adds QoS DSCP 46 preset", async () => {
    const user = userEvent.setup();
    const onMutationComplete = vi.fn();

    mockedClient.probeGameRoutes.mockResolvedValue([
      {
        id: "sa_east_gru",
        regionName: "South America (Brasil)",
        location: "São Paulo (GRU / sa-east-1)",
        targetHost: "ec2.sa-east-1.amazonaws.com",
        avgMs: 12.4,
        minMs: 11.8,
        maxMs: 13.2,
        jitterMs: 0.6,
        lossPercent: 0,
      },
    ]);

    mockedClient.runMultiDnsBenchmark.mockResolvedValue([
      {
        providerId: "cloudflare",
        providerName: "Cloudflare Anycast",
        primaryIp: "1.1.1.1",
        secondaryIp: "1.0.0.1",
        avgMs: 8.5,
        minMs: 8.1,
        jitterMs: 0.4,
        successRate: 100,
      },
    ]);

    mockedClient.discoverOptimalMtu.mockResolvedValue({
      interfaceAlias: "Ethernet",
      currentMtu: 1500,
      optimalMtu: 1492,
      maxUnfragmentedPayload: 1464,
      isOptimal: false,
      connectionTypeHint: "Fibra PPPoE Detectada (1492 bytes)",
    });

    mockedClient.addQosGamePolicy.mockResolvedValue({
      policyName: "Optimizer_Counter_Strike_2",
      gameName: "Counter-Strike 2",
      exeName: "cs2.exe",
      dscpValue: 46,
    });

    render(
      <NetLabView
        locale="pt"
        privilege={{
          isAdmin: true,
          elevationLabel: "Administrador",
          username: "tester",
        }}
        elevating={false}
        onRequestElevation={vi.fn()}
        onMutationComplete={onMutationComplete}
      />
    );

    await user.click(
      screen.getByRole("button", { name: /Sondar Rotas de Jogos/i })
    );
    expect(await screen.findByText("12.4 ms")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Testar 6 DNS/i }));
    expect(await screen.findByText("#1 FASTEST")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Descobrir MTU Ideal/i })
    );
    expect(await screen.findByText("1492")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Counter-Strike 2/i })
    );
    expect(mockedClient.addQosGamePolicy).toHaveBeenCalledWith(
      "Counter-Strike 2",
      "cs2.exe"
    );
  });

  it("renders UpdateModal and CommandPalette actions cleanly", async () => {
    const user = userEvent.setup();
    const onIgnore = vi.fn();
    const onClose = vi.fn();
    const onNavigate = vi.fn();

    render(
      <>
        <UpdateModal
          open={true}
          locale="pt"
          checking={false}
          updateInfo={{
            currentVersion: "0.1.0",
            latestVersion: "0.2.0",
            releaseTag: "v0.2.0",
            releaseName: "Optimizer v0.2.0",
            updateAvailable: true,
            releaseNotes: "### Novidades\n- Aba NetLab estilo ExitLag",
            htmlUrl: "https://github.com/vicode360/optimizer/releases/tag/v0.2.0",
            publishedAt: "2026-11-22T00:00:00Z",
            setupExeUrl:
              "https://github.com/vicode360/optimizer/releases/download/v0.2.0/Optimizer_0.2.0_x64-setup.exe",
            setupExeName: "Optimizer_0.2.0_x64-setup.exe",
            portableExeUrl: null,
            sha256SumsUrl:
              "https://github.com/vicode360/optimizer/releases/download/v0.2.0/SHA256SUMS.txt",
          }}
          checkError={null}
          onClose={onClose}
          onRecheck={vi.fn()}
          onIgnoreVersion={onIgnore}
        />

        <CommandPalette
          open={true}
          locale="pt"
          theme="light"
          tweaks={[]}
          onClose={onClose}
          onNavigate={onNavigate}
          onSelectTweak={vi.fn()}
          onToggleTheme={vi.fn()}
          onToggleLocale={vi.fn()}
          onOpenUpdates={vi.fn()}
          onRunScan={vi.fn()}
          onExportReport={vi.fn()}
        />
      </>
    );

    expect(
      screen.getByText(/Nova atualização disponível!/i)
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Ignorar esta versão/i })
    );
    expect(onIgnore).toHaveBeenCalledWith("v0.2.0");

    await user.click(
      screen.getByRole("button", { name: /Ir para: NetLab \(Ping & QoS\)/i })
    );
    expect(onNavigate).toHaveBeenCalledWith("netlab");
  });

  it("renders dynamic version in Sidebar, hides STREAM 1 HZ in TopBar, translates TweaksView drawer to EN, and updates NetLab Current DNS Applied + Applied button", async () => {
    const user = userEvent.setup();

    mockedClient.runMultiDnsBenchmark.mockResolvedValue([
      {
        providerId: "cloudflare",
        providerName: "Cloudflare Anycast",
        primaryIp: "1.1.1.1",
        secondaryIp: "1.0.0.1",
        avgMs: 7.2,
        minMs: 6.9,
        jitterMs: 0.3,
        successRate: 100,
      },
    ]);

    mockedClient.applyCustomDnsProvider.mockResolvedValue({
      sessionId: "sess-dns-1",
      currentDns: {
        interfaceAlias: "Ethernet",
        servers: ["1.1.1.1", "1.0.0.1"],
        isDhcp: false,
        matchedProviderId: "cloudflare",
        matchedProviderName: "Cloudflare Anycast",
      },
    });

    const sampleTweak: TweakItem = {
      id: "network_disable_nic_power_saving",
      title: "Desativar Economia NIC",
      description: "Descrição PT",
      technicalDetail: "HKLM\\... :: PnPCapabilities -> REG_DWORD=24 (0x18)",
      benchmarkNote: "Nota PT",
      category: "network",
      impact: "high",
      risk: "safe",
      requiresAdmin: true,
      reversible: true,
      applied: true,
      applicable: true,
      hardwareNote: null,
    };

    render(
      <>
        <Sidebar
          activeSection="netlab"
          onSelectSection={vi.fn()}
          locale="en"
          privilege={{
            isAdmin: true,
            elevationLabel: "Administrador",
            username: "tester",
          }}
          privilegeLoading={false}
          elevating={false}
          alertCount={0}
          backupCount={0}
          appliedTweaksCount={1}
          totalTweaksCount={58}
          telemetryConnected={true}
          onRequestElevation={vi.fn()}
        />
        <TopBar
          activeSection="netlab"
          scannedAt="2026-11-22T12:00:00Z"
          scanning={false}
          onRunScan={vi.fn()}
          theme="dark"
          onToggleTheme={vi.fn()}
          locale="en"
          onToggleLocale={vi.fn()}
        />
        <TweaksView
          items={[sampleTweak]}
          selectedIds={[]}
          sessionLabel=""
          locale="en"
          activeBackupSessions={[]}
          loading={false}
          busy={false}
          progress={null}
          lastApplyResult={null}
          lastRevertResult={null}
          error={null}
          diagnostics={[]}
          privilege={{
            isAdmin: true,
            elevationLabel: "Administrador",
            username: "tester",
          }}
          onRefresh={vi.fn()}
          onToggleSelect={vi.fn()}
          onSetSelected={vi.fn()}
          onSessionLabelChange={vi.fn()}
          onClearSelection={vi.fn()}
          onApplySelected={vi.fn()}
          onRevertAllActive={vi.fn()}
          onRequestElevation={vi.fn()}
          onInspectBackupSession={vi.fn()}
        />
        <NetLabView
          locale="en"
          privilege={{
            isAdmin: true,
            elevationLabel: "Administrador",
            username: "tester",
          }}
          elevating={false}
          onRequestElevation={vi.fn()}
          onMutationComplete={vi.fn()}
        />
      </>
    );

    // 1. Dynamic version in Sidebar & no STREAM 1 HZ in TopBar
    expect(screen.getByText(/v0\.2\.1 · Windows/i)).toBeInTheDocument();
    expect(screen.queryByText(/v0\.1\.0/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/STREAM 1 HZ/i)).not.toBeInTheDocument();

    // 2. TweaksView English drawer
    const detailsBtn = screen.getByRole("button", { name: /^Details$/i });
    await user.click(detailsBtn);
    expect(
      screen.getByText("Registry Key / Command / Win32 API")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Technical Evidence / Benchmark")
    ).toBeInTheDocument();
    expect(screen.getByText(/Privilege: Administrator/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Reversible: Yes \(Atomic backup\)/i)
    ).toBeInTheDocument();

    // 3. NetLab Current DNS Applied + Apply -> Applied transition
    expect(await screen.findByText("Current DNS Applied")).toBeInTheDocument();
    expect(screen.getByText("192.168.1.1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Test 6 DNS/i }));
    const applyBtn = await screen.findByRole("button", { name: /^Apply$/i });
    await user.click(applyBtn);

    expect(
      await screen.findByRole("button", { name: /^Applied$/i })
    ).toBeDisabled();
    expect(screen.getByText("1.1.1.1 / 1.0.0.1")).toBeInTheDocument();
  });
});
