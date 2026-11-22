import { memo } from "react";
import {
  Activity,
  Cpu,
  History,
  Power,
  Radar,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { UI_COPY } from "../i18n";
import type { ActiveSection, AppLocale, PrivilegeStatus } from "../types/system";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface SidebarProps {
  activeSection: ActiveSection;
  onSelectSection: (section: ActiveSection) => void;
  locale: AppLocale;
  privilege: PrivilegeStatus | null;
  privilegeLoading: boolean;
  elevating: boolean;
  alertCount: number;
  backupCount: number;
  appliedTweaksCount: number;
  totalTweaksCount: number;
  telemetryConnected: boolean;
  updateAvailable?: boolean;
  onRequestElevation: () => void;
  onOpenUpdates?: () => void;
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
  locale,
  privilege,
  privilegeLoading,
  elevating,
  alertCount,
  backupCount,
  appliedTweaksCount,
  totalTweaksCount,
  telemetryConnected,
  updateAvailable = false,
  onRequestElevation,
  onOpenUpdates,
}: SidebarProps) {
  const copy = UI_COPY[locale].nav;

  const navItems: NavItem[] = [
    {
      id: "diagnostics",
      label: copy.diagnostics,
      icon: Stethoscope,
      badge: alertCount > 0 ? alertCount : undefined,
      badgeVariant: "moderate",
    },
    {
      id: "netlab",
      label: copy.netlab,
      icon: Radar,
      badge: "QoS",
      badgeVariant: "safe",
    },
    {
      id: "tweaks",
      label: copy.tweaks,
      icon: SlidersHorizontal,
      badge:
        totalTweaksCount > 0
          ? `${appliedTweaksCount}/${totalTweaksCount}`
          : undefined,
      badgeVariant: "neutral",
    },
    {
      id: "startup",
      label: copy.startup,
      icon: Power,
    },
    {
      id: "hardware",
      label: copy.hardware,
      icon: Cpu,
    },
    {
      id: "telemetry",
      label: copy.telemetry,
      icon: Activity,
      badge: telemetryConnected ? "LIVE" : undefined,
      badgeVariant: "safe",
    },
    {
      id: "backups",
      label: copy.backups,
      icon: History,
      badge: backupCount > 0 ? backupCount : undefined,
      badgeVariant: "neutral",
    },
  ];

  return (
    <aside className="flex min-h-0 w-60 shrink-0 flex-col border-r-2 border-border bg-secondary-background">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b-2 border-border px-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground shadow-[2px_2px_0px_0px_var(--border)]">
            <Activity className="size-4 stroke-[2.5]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="truncate font-heading text-base leading-none font-bold tracking-tight uppercase">
              Optimizer
            </div>
            <div className="nb-mono mt-1 truncate text-[11px] text-foreground/65">
              v{__APP_VERSION__} · Windows
            </div>
          </div>
        </div>
      </div>

      <nav
        aria-label={locale === "pt" ? "Módulos do sistema" : "System modules"}
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3"
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
              className={`flex w-full cursor-pointer items-center justify-between rounded-base border-2 px-3 py-2 text-left text-sm font-heading font-bold transition-all ${
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

      <div className="space-y-2 border-t-2 border-border p-3">
        {onOpenUpdates && (
          <Button
            type="button"
            variant={updateAvailable ? "success" : "neutral"}
            size="xs"
            onClick={onOpenUpdates}
            className="w-full justify-between"
          >
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="size-3.5" aria-hidden="true" />
              <span>{copy.checkUpdates}</span>
            </span>
            {updateAvailable && (
              <Badge variant="default" className="nb-mono px-1.5 py-0 text-[10px]">
                NEW
              </Badge>
            )}
          </Button>
        )}

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
                  ? copy.verifyingToken
                  : privilege?.isAdmin
                    ? copy.admin
                    : copy.standardUser}
              </div>
              <div className="nb-mono mt-0.5 truncate text-[11px] text-foreground/75">
                {privilege ? privilege.username : "—"}
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
              {elevating ? copy.waitingUac : copy.elevateBtn}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
});
