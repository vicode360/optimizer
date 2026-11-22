import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BenchmarkPanel } from "../components/BenchmarkPanel";
import { StartupView } from "../components/StartupView";
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
  },
}));

const mockedClient = vi.mocked(tauriClient);

describe("New features: i18n, BenchmarkPanel, and StartupView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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
      {
        id: "task::\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator",
        name: "CEIP Consolidator",
        commandOrPath:
          "\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator",
        locationLabel: "Agendador de Tarefas (Windows)",
        source: "scheduledTask",
        enabled: true,
        requiresAdmin: true,
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
});
