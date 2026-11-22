import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Power,
  RefreshCw,
  Search,
  ShieldAlert,
  TerminalSquare,
  X,
} from "lucide-react";
import { UI_COPY } from "../i18n";
import { normalizeAppError, tauriClient } from "../services/tauriClient";
import type {
  AppError,
  AppLocale,
  PrivilegeStatus,
  StartupItem,
} from "../types/system";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";

interface StartupViewProps {
  locale: AppLocale;
  privilege: PrivilegeStatus | null;
  elevating: boolean;
  onRequestElevation: () => void;
  onMutationComplete: () => Promise<void> | void;
}

type SourceFilter = "all" | "run" | "task";

export const StartupView = memo(function StartupView({
  locale,
  privilege,
  elevating,
  onRequestElevation,
  onMutationComplete,
}: StartupViewProps) {
  const copy = UI_COPY[locale].startup;
  const [items, setItems] = useState<StartupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [query, setQuery] = useState("");

  const isAdmin = privilege?.isAdmin ?? false;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await tauriClient.listStartupItems();
      setItems(list);
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = async (item: StartupItem) => {
    if (busyId) return;
    setBusyId(item.id);
    setError(null);
    try {
      await tauriClient.setStartupItemEnabled(item.id, !item.enabled);
      await refresh();
      await onMutationComplete();
    } catch (err) {
      setError(normalizeAppError(err));
    } finally {
      setBusyId(null);
    }
  };

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "run" && item.source === "scheduledTask") return false;
      if (filter === "task" && item.source !== "scheduledTask") return false;
      if (q.length > 0) {
        const hay =
          `${item.name} ${item.commandOrPath} ${item.locationLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, filter, query]);

  return (
    <div className="space-y-4">
      {privilege && !privilege.isAdmin && (
        <Alert variant="warning">
          <ShieldAlert className="size-4" aria-hidden="true" />
          <AlertTitle>
            {locale === "pt"
              ? "Elevação recomendada para HKLM Run e Tarefas Agendadas"
              : "Elevation required for HKLM Run & Scheduled Tasks"}
          </AlertTitle>
          <AlertDescription className="flex w-full flex-wrap items-center justify-between gap-3">
            <span className="max-w-2xl text-xs">
              {locale === "pt"
                ? "Itens HKCU Run do usuário atual podem ser alterados sem UAC, mas chaves HKLM e Tarefas Agendadas do Windows exigem Administrador."
                : "Current-user HKCU Run entries can be toggled without UAC, while HKLM and Windows Scheduled Tasks require Administrator privileges."}
            </span>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              disabled={elevating}
              onClick={onRequestElevation}
            >
              {elevating
                ? UI_COPY[locale].nav.waitingUac
                : UI_COPY[locale].nav.elevateBtn}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
              <Power className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-heading text-base font-bold">
                {copy.headerTitle}
              </h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground/80">
                {copy.headerDesc}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="neutral"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading || busyId !== null}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span>{copy.refreshBtn}</span>
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>[{error.code}]</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative max-w-md flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground/60"
            aria-hidden="true"
          />
          <Input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchPlaceholder}
            aria-label={copy.searchPlaceholder}
            className="h-10 pr-9 pl-9 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer rounded p-0.5 text-foreground/65 hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Filtro de origem de inicialização"
          className="inline-flex flex-wrap items-center gap-1 rounded-base border-2 border-border bg-secondary-background p-1 shadow-shadow"
        >
          {(
            [
              { id: "all", label: copy.all },
              { id: "run", label: copy.registryRun },
              { id: "task", label: copy.scheduledTasks },
            ] as const
          ).map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex cursor-pointer items-center justify-center rounded-base border-2 px-3 py-1 text-xs font-heading font-bold transition-colors ${
                  active
                    ? "border-border bg-main text-main-foreground"
                    : "border-transparent bg-transparent text-foreground hover:bg-background"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {loading && items.length === 0 ? (
        <Card>
          <CardContent className="nb-mono text-xs font-bold">
            {locale === "pt"
              ? "Lendo chaves Run, StartupApproved e Tarefas Agendadas..."
              : "Reading Run keys, StartupApproved flags, and Scheduled Tasks..."}
          </CardContent>
        </Card>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm font-medium text-foreground/75">
            {copy.empty}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <div className="divide-y-2 divide-border">
            {visibleItems.map((item) => {
              const isTask = item.source === "scheduledTask";
              const lockedByAdmin = item.requiresAdmin && !isAdmin;
              const isItemBusy = busyId === item.id;

              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-base border-2 border-border text-main-foreground ${
                        isTask ? "bg-chart-5" : "bg-main"
                      }`}
                    >
                      {isTask ? (
                        <CalendarClock className="size-4" aria-hidden="true" />
                      ) : (
                        <TerminalSquare className="size-4" aria-hidden="true" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-heading text-sm font-bold">
                          {item.name}
                        </span>
                        <Badge variant={item.enabled ? "safe" : "neutral"}>
                          {item.enabled ? copy.enabled : copy.disabled}
                        </Badge>
                        <Badge variant="neutral">{item.locationLabel}</Badge>
                      </div>
                      <div className="nb-mono mt-1 break-all text-xs text-foreground/75">
                        {item.commandOrPath}
                      </div>
                    </div>
                  </div>

                  <Button
                    type="button"
                    variant={item.enabled ? "neutral" : "success"}
                    size="sm"
                    disabled={busyId !== null || lockedByAdmin}
                    onClick={() => void handleToggle(item)}
                    className="shrink-0 self-start sm:self-center"
                  >
                    {isItemBusy ? (
                      <RefreshCw
                        className="size-3.5 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    <span>
                      {item.enabled ? copy.disableBtn : copy.enableBtn}
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
});
