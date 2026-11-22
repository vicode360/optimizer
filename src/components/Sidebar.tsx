import { memo } from "react";
import {
  Activity,
  Cpu,
  History,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import type { ActiveSection, PrivilegeStatus } from "../types/system";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface SidebarProps {
  activeSection: ActiveSection;
  onSelectSection: (section: ActiveSection) => void;
  privilege: PrivilegeStatus | null;
  privilegeLoading: boolean;
  elevating: boolean;
  alertCount: number;
  backupCount: number;
  appliedTweaksCount: number;
  totalTweaksCount: number;
  telemetryConnected: boolean;
  onRequestElevation: () => void;
}

interface NavItem {
  id: ActiveSection;
  label: string;
  icon: typeof Stethoscope;
  badge?: string | number;
  badgeVariant?: "default" | "neutral" | "safe" | "moderate";
}

export const Sidebar = memo(function Sidebar({
  activeSection,
  onSelectSection,
  privilege,
  privilegeLoading,
  elevating,
  alertCount,
  backupCount,
  appliedTweaksCount,
  totalTweaksCount,
  telemetryConnected,
  onRequestElevation,
}: SidebarProps) {
  const navItems: NavItem[] = [
    {
      id: "diagnostics",
      label: "Diagnóstico",
      icon: Stethoscope,
      badge: alertCount > 0 ? alertCount : undefined,
      badgeVariant: "moderate",
    },
    {
      id: "hardware",
      label: "Hardware",
      icon: Cpu,
    },
    {
      id: "telemetry",
      label: "Telemetria",
      icon: Activity,
      badge: telemetryConnected ? "LIVE" : undefined,
      badgeVariant: "safe",
    },
    {
      id: "tweaks",
      label: "Tweaks",
      icon: SlidersHorizontal,
      badge:
        totalTweaksCount > 0
          ? `${appliedTweaksCount}/${totalTweaksCount}`
          : undefined,
      badgeVariant: "neutral",
    },
    {
      id: "backups",
      label: "Backups",
      icon: History,
      badge: backupCount > 0 ? backupCount : undefined,
      badgeVariant: "neutral",
    },
  ];

  return (
    <aside className="flex min-h-0 w-60 shrink-0 flex-col border-r-2 border-border bg-secondary-background">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b-2 border-border px-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-[2px_2px_0px_0px_var(--border)]">
          <Activity className="size-4 stroke-[2.5]" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-heading text-base leading-none font-bold tracking-tight uppercase">
            Optimizer
          </div>
          <div className="nb-mono mt-1 truncate text-[11px] text-foreground/65">
            Windows Console
          </div>
        </div>
      </div>

      <nav
        aria-label="Módulos do sistema"
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => onSelectSection(item.id)}
              className={`flex w-full cursor-pointer items-center justify-between rounded-base border-2 px-3 py-2.5 text-left text-sm font-heading font-bold transition-all ${
                isActive
                  ? "border-border bg-main text-main-foreground shadow-shadow"
                  : "border-transparent bg-transparent text-foreground hover:border-border hover:bg-background"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </span>

              {item.badge !== undefined && (
                <Badge
                  variant={item.badgeVariant ?? "neutral"}
                  className="nb-mono ml-2 px-1.5 py-0 text-[10.5px]"
                >
                  {item.badge}
                </Badge>
              )}
            </button>
          );
        })}
      </nav>

      <div className="border-t-2 border-border p-3">
        <div
          className={`rounded-base border-2 border-border p-3 shadow-[3px_3px_0px_0px_var(--border)] ${
            privilege?.isAdmin
              ? "bg-chart-4/20"
              : privilegeLoading
                ? "bg-background"
                : "bg-chart-3/25"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div
              className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-base border-2 border-border text-main-foreground ${
                privilege?.isAdmin ? "bg-chart-4" : "bg-chart-3"
              }`}
            >
              {privilege?.isAdmin ? (
                <ShieldCheck className="size-4" aria-hidden="true" />
              ) : (
                <ShieldAlert className="size-4" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-heading text-xs font-bold">
                {privilegeLoading
                  ? "Verificando token..."
                  : privilege?.isAdmin
                    ? "Administrador"
                    : "Usuário padrão"}
              </div>
              <div className="nb-mono mt-0.5 truncate text-[11px] text-foreground/75">
                {privilege ? privilege.username : "Sem leitura"}
              </div>
            </div>
          </div>

          {!privilegeLoading && privilege && !privilege.isAdmin && (
            <Button
              type="button"
              size="xs"
              disabled={elevating}
              className="mt-3 w-full bg-chart-3 text-main-foreground"
              onClick={onRequestElevation}
            >
              {elevating ? "Aguardando UAC..." : "Elevar como Admin"}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
});
