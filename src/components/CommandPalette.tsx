import { useEffect, useMemo, useState } from "react";
import {
  Command,
  FileDown,
  Languages,
  Moon,
  Radar,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { localizeTweak, UI_COPY } from "../i18n";
import type { ActiveSection, AppLocale, TweakItem } from "../types/system";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";

interface CommandPaletteProps {
  open: boolean;
  locale: AppLocale;
  theme: "light" | "dark";
  tweaks: TweakItem[];
  onClose: () => void;
  onNavigate: (section: ActiveSection) => void;
  onSelectTweak: (tweakId: string) => void;
  onToggleTheme: () => void;
  onToggleLocale: () => void;
  onOpenUpdates: () => void;
  onRunScan: () => void;
  onExportReport: () => void;
}

interface PaletteAction {
  id: string;
  label: string;
  category: string;
  icon: typeof Command;
  onExecute: () => void;
}

export function CommandPalette({
  open,
  locale,
  theme,
  tweaks,
  onClose,
  onNavigate,
  onSelectTweak,
  onToggleTheme,
  onToggleLocale,
  onOpenUpdates,
  onRunScan,
  onExportReport,
}: CommandPaletteProps) {
  const isPt = locale === "pt";
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const actions: PaletteAction[] = useMemo(() => {
    const nav = UI_COPY[locale].nav;
    const catNav = isPt ? "Navegação" : "Navigation";
    const catSys = isPt ? "Sistema" : "System";
    const catPref = isPt ? "Preferências" : "Preferences";
    const baseActions: PaletteAction[] = [
      {
        id: "nav_diagnostics",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.diagnostics}`,
        category: catNav,
        icon: Radar,
        onExecute: () => onNavigate("diagnostics"),
      },
      {
        id: "nav_netlab",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.netlab}`,
        category: catNav,
        icon: Radar,
        onExecute: () => onNavigate("netlab"),
      },
      {
        id: "nav_tweaks",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.tweaks}`,
        category: catNav,
        icon: SlidersHorizontal,
        onExecute: () => onNavigate("tweaks"),
      },
      {
        id: "nav_startup",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.startup}`,
        category: catNav,
        icon: SlidersHorizontal,
        onExecute: () => onNavigate("startup"),
      },
      {
        id: "nav_hardware",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.hardware}`,
        category: catNav,
        icon: Radar,
        onExecute: () => onNavigate("hardware"),
      },
      {
        id: "nav_telemetry",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.telemetry}`,
        category: catNav,
        icon: Radar,
        onExecute: () => onNavigate("telemetry"),
      },
      {
        id: "nav_backups",
        label: `${isPt ? "Ir para" : "Go to"}: ${nav.backups}`,
        category: catNav,
        icon: Radar,
        onExecute: () => onNavigate("backups"),
      },
      {
        id: "act_updates",
        label: isPt
          ? "Verificar Atualizações no GitHub (Releases)"
          : "Check for GitHub Updates (Releases)",
        category: catSys,
        icon: Sparkles,
        onExecute: onOpenUpdates,
      },
      {
        id: "act_export",
        label: isPt
          ? "Exportar Laudo Técnico do Sistema (.md)"
          : "Export Technical System Audit Report (.md)",
        category: catSys,
        icon: FileDown,
        onExecute: onExportReport,
      },
      {
        id: "act_scan",
        label: isPt
          ? "Reescanear Hardware e Diagnósticos"
          : "Rescan Hardware & Diagnostics",
        category: catSys,
        icon: RefreshCw,
        onExecute: onRunScan,
      },
      {
        id: "act_theme",
        label: isPt
          ? `Alternar Tema (${theme === "light" ? "Ativar Escuro" : "Ativar Claro"})`
          : `Toggle Theme (${theme === "light" ? "Switch to Dark" : "Switch to Light"})`,
        category: catPref,
        icon: theme === "light" ? Moon : Sun,
        onExecute: onToggleTheme,
      },
      {
        id: "act_locale",
        label: isPt
          ? "Mudar Idioma para Inglês (EN-US)"
          : "Switch Language to Portuguese (PT-BR)",
        category: catPref,
        icon: Languages,
        onExecute: onToggleLocale,
      },
    ];

    const tweakActions: PaletteAction[] = tweaks.map((t) => {
      const loc = localizeTweak(t, locale);
      return {
        id: `tweak_${t.id}`,
        label: `${loc.title} (${t.id})`,
        category: `Tweak · ${t.risk.toUpperCase()}`,
        icon: SlidersHorizontal,
        onExecute: () => {
          onSelectTweak(t.id);
          onNavigate("tweaks");
        },
      };
    });

    return [...baseActions, ...tweakActions];
  }, [
    locale,
    isPt,
    theme,
    tweaks,
    onNavigate,
    onSelectTweak,
    onToggleTheme,
    onToggleLocale,
    onOpenUpdates,
    onRunScan,
    onExportReport,
  ]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 14);
    return actions
      .filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.category.toLowerCase().includes(q)
      )
      .slice(0, 16);
  }, [actions, query]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-20"
    >
      <Card className="w-full max-w-xl overflow-hidden py-0">
        <div className="flex items-center gap-2 border-b-2 border-border bg-main/20 px-4 py-3">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <Input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isPt
                ? "Digite um comando, aba ou tweak (ex: netlab, dscp, bbr2, dns, update)..."
                : "Type a command, tab, or tweak (e.g. netlab, dscp, bbr2, dns, update)..."
            }
            aria-label={
              isPt ? "Buscar comando rápido" : "Search quick command"
            }
            className="h-9 flex-1 text-xs"
          />
          <Button
            type="button"
            variant="neutral"
            size="icon-xs"
            onClick={onClose}
            aria-label={
              isPt ? "Fechar Command Palette" : "Close Command Palette"
            }
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="max-h-80 divide-y-2 divide-border overflow-y-auto bg-secondary-background">
          {filtered.length === 0 ? (
            <div className="p-5 text-center text-xs text-foreground/75">
              {isPt ? "Nenhum comando encontrado." : "No matching command found."}
            </div>
          ) : (
            filtered.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    item.onExecute();
                    onClose();
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-main/20"
                >
                  <span className="flex min-w-0 items-center gap-2.5 font-heading font-bold">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  <Badge variant="neutral" className="nb-mono shrink-0">
                    {item.category}
                  </Badge>
                </button>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
