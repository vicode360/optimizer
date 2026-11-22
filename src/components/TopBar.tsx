import {
  Command,
  FileDown,
  Languages,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
} from "lucide-react";
import { UI_COPY } from "../i18n";
import type { ActiveSection, AppLocale } from "../types/system";
import { formatTimestamp } from "../utils/format";
import { Button } from "./ui/button";

interface TopBarProps {
  activeSection: ActiveSection;
  scannedAt: string | null;
  scanning: boolean;
  onRunScan: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  locale: AppLocale;
  onToggleLocale: () => void;
  updateAvailable?: boolean;
  onOpenUpdates?: () => void;
  onOpenCommandPalette?: () => void;
  onExportReport?: () => void;
}

export function TopBar({
  activeSection,
  scannedAt,
  scanning,
  onRunScan,
  theme,
  onToggleTheme,
  locale,
  onToggleLocale,
  updateAvailable = false,
  onOpenUpdates,
  onOpenCommandPalette,
  onExportReport,
}: TopBarProps) {
  const copy = UI_COPY[locale].topBar;

  const sectionMeta: Record<
    ActiveSection,
    { title: string; subtitle: string }
  > = {
    diagnostics: {
      title: copy.diagnosticsTitle,
      subtitle: copy.diagnosticsSub,
    },
    netlab: {
      title: copy.netlabTitle,
      subtitle: copy.netlabSub,
    },
    hardware: {
      title: copy.hardwareTitle,
      subtitle: copy.hardwareSub,
    },
    telemetry: {
      title: copy.telemetryTitle,
      subtitle: copy.telemetrySub,
    },
    startup: {
      title: copy.startupTitle,
      subtitle: copy.startupSub,
    },
    backups: {
      title: copy.backupsTitle,
      subtitle: copy.backupsSub,
    },
    tweaks: {
      title: copy.tweaksTitle,
      subtitle: copy.tweaksSub,
    },
  };

  const meta = sectionMeta[activeSection];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b-2 border-border bg-secondary-background px-6">
      <div className="min-w-0">
        <h1 className="truncate font-heading text-lg leading-tight font-bold tracking-tight">
          {meta.title}
        </h1>
        <p className="truncate text-xs text-foreground/70">{meta.subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {updateAvailable && onOpenUpdates && (
          <Button
            type="button"
            variant="success"
            size="xs"
            onClick={onOpenUpdates}
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            <span>UPDATE</span>
          </Button>
        )}

        {onOpenCommandPalette && (
          <Button
            type="button"
            variant="neutral"
            size="xs"
            onClick={onOpenCommandPalette}
            title="Command Palette (Ctrl + K)"
            className="nb-mono hidden sm:inline-flex"
          >
            <Command className="size-3.5" aria-hidden="true" />
            <span>Ctrl+K</span>
          </Button>
        )}

        {onExportReport && (
          <Button
            type="button"
            variant="neutral"
            size="xs"
            onClick={onExportReport}
            title={
              locale === "pt"
                ? "Exportar Laudo Técnico (.md)"
                : "Export Audit Report (.md)"
            }
            className="hidden md:inline-flex"
          >
            <FileDown className="size-3.5" aria-hidden="true" />
            <span>{locale === "pt" ? "Laudo" : "Report"}</span>
          </Button>
        )}

        {scannedAt && (
          <div className="hidden border-l-2 border-border pl-2.5 text-right lg:block">
            <div className="text-[10.5px] font-heading font-bold uppercase text-foreground/65">
              {copy.lastScan}
            </div>
            <div className="nb-mono text-xs">
              {formatTimestamp(scannedAt, locale)}
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="neutral"
          size="xs"
          onClick={onToggleLocale}
          aria-label={
            locale === "pt"
              ? "Alternar idioma PT / EN"
              : "Switch language PT / EN"
          }
          title="PT-BR / EN-US"
          className="nb-mono"
        >
          <Languages className="size-3.5" aria-hidden="true" />
          <span>{locale.toUpperCase()}</span>
        </Button>

        <Button
          type="button"
          variant="neutral"
          size="icon-sm"
          onClick={onToggleTheme}
          aria-label={
            locale === "pt"
              ? theme === "light"
                ? "Ativar tema escuro"
                : "Ativar tema claro"
              : theme === "light"
                ? "Switch to dark theme"
                : "Switch to light theme"
          }
          title={
            locale === "pt"
              ? theme === "light"
                ? "Tema escuro"
                : "Tema claro"
              : theme === "light"
                ? "Dark theme"
                : "Light theme"
          }
        >
          {theme === "light" ? (
            <Moon className="size-4" aria-hidden="true" />
          ) : (
            <Sun className="size-4" aria-hidden="true" />
          )}
        </Button>

        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={onRunScan}
          disabled={scanning}
        >
          <RefreshCw
            className={`size-3.5 ${scanning ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          <span>{scanning ? copy.scanningBtn : copy.rescan}</span>
        </Button>
      </div>
    </header>
  );
}
