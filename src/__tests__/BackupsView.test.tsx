import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BackupsView, describeTarget } from "../components/BackupsView";
import type { BackupSession, BackupTarget } from "../types/system";

describe("BackupsView and target descriptions", () => {
  it("describes all BackupTarget variants including netshIpGlobal", () => {
    const targets: BackupTarget[] = [
      {
        targetType: "registryValue",
        hive: "hklm",
        subkey: "SOFTWARE\\Test",
        valueName: "Mode",
        original: { kind: "dword", value: 1 },
      },
      {
        targetType: "serviceStartType",
        serviceName: "DiagTrack",
        originalStartType: 2,
        wasRunning: true,
      },
      {
        targetType: "powerPlan",
        originalSchemeGuid: "381b4222",
        originalSchemeName: "Balanced",
      },
      {
        targetType: "powerSettingValue",
        schemeGuid: "381b4222",
        subgroupGuid: "sub",
        settingGuid: "set",
        originalAcIndex: 1,
        originalDcIndex: 1,
      },
      {
        targetType: "hibernationState",
        wasEnabled: true,
      },
      {
        targetType: "fsutilBehavior",
        key: "disablelastaccess",
        originalValue: 2,
      },
      {
        targetType: "netshTcpGlobal",
        setting: "rss",
        originalValue: "enabled",
      },
      {
        targetType: "netshIpGlobal",
        family: "ipv4",
        setting: "loopbacklargemtu",
        originalValue: "enable",
      },
      {
        targetType: "netshSupplementalTcp",
        template: "internet",
        originalProvider: "cubic",
      },
      {
        targetType: "netAdapterDns",
        interfaceAlias: "Ethernet",
        wasDhcp: true,
        originalServers: [],
      },
      {
        targetType: "scheduledTaskState",
        taskPath: "\\Microsoft\\Windows\\CEIP\\Consolidator",
        wasEnabled: true,
      },
      {
        targetType: "snapshotNote",
        description: "Standby RAM",
        originalValue: "10 GiB",
      },
    ];

    const descriptions = targets.map(describeTarget);
    expect(descriptions[7]).toBe(
      "netsh int ipv4 global loopbacklargemtu -> original=enable"
    );
    expect(descriptions[10]).toContain("Tarefa Agendada");
    expect(descriptions.every((d) => d.length > 0)).toBe(true);
  });

  it("requires 2-step confirmation before reverting an active backup session", async () => {
    const user = userEvent.setup();
    const onRevert = vi.fn();

    const session: BackupSession = {
      sessionId: "sess-123",
      createdAt: "2026-01-10T10:00:00Z",
      restoredAt: null,
      label: "Lote Competitivo",
      entries: [
        {
          tweakId: "network_tcp_bbr2",
          tweakTitle: "TCP BBR2",
          targets: [
            {
              targetType: "netshIpGlobal",
              family: "ipv4",
              setting: "loopbacklargemtu",
              originalValue: "enable",
            },
          ],
        },
      ],
    };

    render(
      <BackupsView
        directory="C:\\Users\\test\\AppData\\Roaming\\optimizer\\backups"
        sessions={[
          {
            sessionId: "sess-123",
            createdAt: "2026-01-10T10:00:00Z",
            restoredAt: null,
            label: "Lote Competitivo",
            tweakCount: 1,
            filePath: "C:\\backups\\sess-123.json",
          },
        ]}
        selectedSession={session}
        loading={false}
        loadingSession={false}
        busy={false}
        progress={null}
        lastRevertResult={null}
        error={null}
        privilege={{
          isAdmin: true,
          elevationLabel: "Administrador",
          username: "tester",
        }}
        onRefresh={vi.fn()}
        onInspectSession={vi.fn()}
        onRevertSession={onRevert}
        onRequestElevation={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: /Reverter sessão/i }));
    expect(onRevert).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /Confirmar reversão/i })
    );
    expect(onRevert).toHaveBeenCalledWith("sess-123");
  });
});
