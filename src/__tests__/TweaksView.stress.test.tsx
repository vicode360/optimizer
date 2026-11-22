import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TweaksView } from "../components/TweaksView";
import type { TweakCategory, TweakItem, TweakRisk } from "../types/system";

const CATEGORIES: TweakCategory[] = [
  "gaming",
  "gpu",
  "network",
  "power",
  "input",
  "debloat",
  "security",
];

const RISKS: TweakRisk[] = ["safe", "moderate", "advanced"];

function buildCatalog(count: number): TweakItem[] {
  const fixed: TweakItem[] = [
    {
      id: "registry_mmcss_gaming",
      title: "MMCSS Prioridade de Jogos",
      description: "Ajusta SystemResponsiveness para 0",
      technicalDetail: "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile",
      benchmarkNote: "Reduz jitter de frame pacing",
      category: "gaming",
      impact: "high",
      risk: "safe",
      requiresAdmin: true,
      reversible: true,
      applied: false,
      applicable: true,
      hardwareNote: null,
    },
    {
      id: "security_disable_smbv1",
      title: "Desativar SMBv1",
      description: "Bloqueia protocolo legado vulnerável",
      technicalDetail: "HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters :: SMB1=0",
      benchmarkNote: "CIS Benchmark",
      category: "security",
      impact: "high",
      risk: "safe",
      requiresAdmin: true,
      reversible: true,
      applied: false,
      applicable: true,
      hardwareNote: null,
    },
  ];

  const items = [...fixed];
  for (let i = items.length; i < count; i++) {
    items.push({
      id: `tweak_item_${i}`,
      title: `Otimização Técnica #${i}`,
      description: `Descrição detalhada do tweak número ${i}`,
      technicalDetail: `HKLM\\SYSTEM\\TestKey\\Item${i} :: Value=1`,
      benchmarkNote: `Referência técnica ${i}`,
      category: CATEGORIES[i % CATEGORIES.length],
      impact: i % 3 === 0 ? "high" : "medium",
      risk: RISKS[i % RISKS.length],
      requiresAdmin: true,
      reversible: true,
      applied: i % 10 === 0,
      applicable: i !== count - 1,
      hardwareNote: i === count - 1 ? "Hardware incompatível" : null,
    });
  }
  return items;
}

function StatefulTweaksHarness({
  onApplySelected,
  onRevertAllActive,
}: {
  onApplySelected: (label?: string) => void;
  onRevertAllActive: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [sessionLabel, setSessionLabel] = useState("");
  const items = buildCatalog(58);

  return (
    <TweaksView
      items={items}
      selectedIds={selectedIds}
      sessionLabel={sessionLabel}
      activeBackupSessions={[
        {
          sessionId: "sess-1",
          createdAt: "2026-01-01T12:00:00Z",
          restoredAt: null,
          label: "Backup Teste",
          tweakCount: 3,
          filePath: "C:\\backups\\sess-1.json",
        },
      ]}
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
      onToggleSelect={(id) =>
        setSelectedIds((prev) =>
          prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        )
      }
      onSetSelected={setSelectedIds}
      onSessionLabelChange={setSessionLabel}
      onClearSelection={() => {
        setSelectedIds([]);
        setSessionLabel("");
      }}
      onApplySelected={onApplySelected}
      onRevertAllActive={onRevertAllActive}
      onRequestElevation={vi.fn()}
      onInspectBackupSession={vi.fn()}
    />
  );
}

describe("TweaksView stress and regression tests", () => {
  it("renders 58 tweaks with zero hidden checkbox inputs and handles rapid multi-selection, filters, presets, drawers, and 2-step revert", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    const onRevertAll = vi.fn();

    const { container } = render(
      <StatefulTweaksHarness
        onApplySelected={onApply}
        onRevertAllActive={onRevertAll}
      />
    );

    // Regression guard against the WebView2 half-screen black-tile bug
    expect(container.querySelectorAll(".sr-only")).toHaveLength(0);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(screen.getByText("58 / 58")).toBeInTheDocument();

    // Rapidly toggle multiple tweaks via checkboxes and titles
    const firstCheckbox = screen.getByRole("checkbox", {
      name: /Selecionar MMCSS Prioridade de Jogos/i,
    });
    const secondCheckbox = screen.getByRole("checkbox", {
      name: /Selecionar Desativar SMBv1/i,
    });
    await user.click(firstCheckbox);
    await user.click(secondCheckbox);
    expect(screen.getByText("2 selecionado(s)")).toBeInTheDocument();

    // Apply with label
    await user.click(
      screen.getByRole("button", { name: /Aplicar com backup \(2\)/i })
    );
    expect(onApply).toHaveBeenCalledTimes(1);

    // Filter via search + clear
    const searchInput = screen.getByLabelText("Buscar tweaks");
    await user.type(searchInput, "SMBv1");
    expect(screen.getByText("1 / 58")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Limpar busca" }));
    expect(screen.getByText("58 / 58")).toBeInTheDocument();

    // Expand technical drawer via Base UI Collapsible
    const detailButtons = screen.getAllByRole("button", { name: /Detalhes/i });
    await user.click(detailButtons[0]);
    expect(
      screen.getByText(
        "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile"
      )
    ).toBeInTheDocument();

    // Preset selection
    await user.click(
      screen.getByRole("button", { name: /Hardening Segurança/i })
    );
    expect(screen.queryByText("0 selecionado(s)")).not.toBeInTheDocument();

    // 2-step inline Revert All confirmation
    await user.click(screen.getByRole("button", { name: /Reverter Tudo \(1\)/i }));
    expect(onRevertAll).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onRevertAll).toHaveBeenCalledTimes(1);
  });
});
