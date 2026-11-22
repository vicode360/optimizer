import { Moon, RefreshCw, Sun } from "lucide-react";
import type { ActiveSection } from "../types/system";
import { formatTimestamp } from "../utils/format";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

interface TopBarProps {
  activeSection: ActiveSection;
  scannedAt: string | null;
  scanning: boolean;
  onRunScan: () => void;
  telemetryConnected: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

const SECTION_META: Record<
  ActiveSection,
  { title: string; subtitle: string }
> = {
  diagnostics: {
    title: "Diagnóstico",
    subtitle: "Saúde do sistema, métricas instantâneas e recomendações reais",
  },
  hardware: {
    title: "Hardware e periféricos",
    subtitle: "Inventário nativo via sysinfo, WMI e Win32 GDI",
  },
  telemetry: {
    title: "Telemetria ao vivo",
    subtitle: "Monitoramento contínuo de CPU, memória e tráfego de rede (1 Hz)",
  },
  backups: {
    title: "Backups e segurança",
    subtitle: "Snapshots atômicos gravados em %AppData%/optimizer/backups",
  },
  tweaks: {
    title: "Tweaks do sistema",
    subtitle: "58 otimizações auditadas com backup atômico prévio e reversão exata",
  },
};

export function TopBar({
  activeSection,
  scannedAt,
  scanning,
  onRunScan,
  telemetryConnected,
  theme,
  onToggleTheme,
}: TopBarProps) {
  const meta = SECTION_META[activeSection];

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b-2 border-border bg-secondary-background px-6">
      <div className="min-w-0">
        <h1 className="truncate font-heading text-lg leading-tight font-bold tracking-tight">
          {meta.title}
        </h1>
        <p className="truncate text-xs text-foreground/70">{meta.subtitle}</p>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Badge
          variant={scanning ? "default" : telemetryConnected ? "safe" : "neutral"}
          className="nb-mono hidden lg:inline-flex"
        >
          <span
            className={`size-2 rounded-full border border-border ${
              scanning
                ? "animate-pulse bg-secondary-background"
                : telemetryConnected
                  ? "bg-border"
                  : "bg-foreground/40"
            }`}
            aria-hidden="true"
          />
          <span>
            {scanning
              ? "ESCANEANDO"
              : telemetryConnected
                ? "STREAM 1 HZ"
                : "STANDBY"}
          </span>
        </Badge>

        {scannedAt && (
          <div className="hidden border-l-2 border-border pl-3 text-right sm:block">
            <div className="text-[10.5px] font-heading font-bold uppercase text-foreground/65">
              Último scan
            </div>
            <div className="nb-mono text-xs">{formatTimestamp(scannedAt)}</div>
          </div>
        )}

        <Button
          type="button"
          variant="neutral"
          size="icon-sm"
          onClick={onToggleTheme}
          aria-label={
            theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"
          }
          title={theme === "light" ? "Tema escuro" : "Tema claro"}
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
          <span>{scanning ? "Escaneando" : "Reescanear"}</span>
        </Button>
      </div>
    </header>
  );
}
