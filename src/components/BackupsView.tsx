import { memo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FolderLock,
  History,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { localizePrivilegeLabel, localizeTweakTitle } from "../i18n";
import type {
  AppError,
  AppLocale,
  BackupSession,
  BackupSessionSummary,
  BackupTarget,
  PrivilegeStatus,
  RegistryOriginalValue,
  RevertSessionResult,
  TweakProgressEvent,
} from "../types/system";
import { formatTimestamp } from "../utils/format";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Progress } from "./ui/progress";

interface BackupsViewProps {
  directory: string | null;
  sessions: BackupSessionSummary[];
  selectedSession: BackupSession | null;
  loading: boolean;
  loadingSession: boolean;
  busy: boolean;
  elevating?: boolean;
  locale?: AppLocale;
  progress: TweakProgressEvent | null;
  lastRevertResult: RevertSessionResult | null;
  error: AppError | null;
  privilege: PrivilegeStatus | null;
  privilegeLoading?: boolean;
  onRefresh: () => void;
  onInspectSession: (sessionId: string) => void;
  onRevertSession: (sessionId: string) => void;
  onRevertSingleTweak?: (tweakId: string, sessionId: string) => void;
  onRequestElevation: () => void;
}

export const BackupsView = memo(function BackupsView({
  directory,
  sessions,
  selectedSession,
  loading,
  loadingSession,
  busy,
  elevating = false,
  locale = "pt",
  progress,
  lastRevertResult,
  error,
  privilege,
  privilegeLoading = false,
  onRefresh,
  onInspectSession,
  onRevertSession,
  onRevertSingleTweak,
  onRequestElevation,
}: BackupsViewProps) {
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);
  const isPt = locale === "pt";

  const isAdmin = privilege?.isAdmin ?? false;
  const canRevertSelected =
    selectedSession !== null &&
    selectedSession.restoredAt === null &&
    isAdmin &&
    !busy;

  const handleSelectSession = (sessionId: string) => {
    setConfirmSessionId(null);
    onInspectSession(sessionId);
  };

  const handleConfirmRevert = () => {
    if (!selectedSession || !canRevertSelected) return;
    setConfirmSessionId(null);
    onRevertSession(selectedSession.sessionId);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
                <FolderLock className="size-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="font-heading text-base font-bold">
                  {locale === "pt"
                    ? "Cofre de snapshots atômicos"
                    : "Atomic Snapshot Vault"}
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground/80">
                  {locale === "pt"
                    ? "Toda mutação de Registro, Serviços, Plano de Energia, TCP/IP, Inicialização ou NTFS grava primeiro o estado original em disco antes de alterar o Windows."
                    : "Every Registry, Service, Power Plan, TCP/IP, Startup, or NTFS mutation first persists its exact pre-mutation state to disk before modifying Windows."}
                </p>
                <div className="nb-mono mt-2.5 inline-block break-all rounded-base border-2 border-border bg-background px-3 py-1 text-xs font-bold">
                  {directory ??
                    (isPt
                      ? "Resolvendo %AppData%/optimizer/backups..."
                      : "Resolving %AppData%/optimizer/backups...")}
                </div>
              </div>
            </div>

            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={onRefresh}
              disabled={loading || busy}
            >
              <RefreshCw
                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
              <span>{isPt ? "Atualizar lista" : "Refresh list"}</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-border pt-3.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={isAdmin ? "safe" : "moderate"}>
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>
                  Token:{" "}
                  {privilegeLoading
                    ? isPt
                      ? "Verificando..."
                      : "Checking..."
                    : localizePrivilegeLabel(privilege?.elevationLabel, locale)}
                </span>
              </Badge>
              <Badge variant="neutral" className="nb-mono">
                {isPt ? "Sessões gravadas" : "Saved sessions"}:{" "}
                {sessions.length}
              </Badge>
            </div>

            {privilege && !privilege.isAdmin && (
              <Button
                type="button"
                size="sm"
                disabled={elevating}
                className="bg-chart-3 text-main-foreground"
                onClick={onRequestElevation}
              >
                {elevating
                  ? isPt
                    ? "Aguardando UAC..."
                    : "Waiting for UAC..."
                  : isPt
                    ? "Reiniciar como Administrador"
                    : "Restart as Administrator"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {busy && progress && progress.phase === "reverting" && (
        <Card className="py-4">
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="nb-mono font-bold">{progress.message}</span>
              <span className="nb-mono font-bold">
                {progress.current}/{progress.total}
              </span>
            </div>
            <Progress
              value={
                progress.total > 0
                  ? Math.min(100, (progress.current / progress.total) * 100)
                  : 20
              }
            />
          </CardContent>
        </Card>
      )}

      {lastRevertResult && (
        <Alert
          variant={
            lastRevertResult.failures.length === 0 ? "success" : "warning"
          }
        >
          {lastRevertResult.failures.length === 0 ? (
            <CheckCircle2 className="size-4" aria-hidden="true" />
          ) : (
            <AlertTriangle className="size-4" aria-hidden="true" />
          )}
          <AlertTitle>
            {isPt
              ? `${lastRevertResult.revertedCount} tweak(s) restaurados para o estado original${
                  lastRevertResult.failures.length > 0
                    ? ` · ${lastRevertResult.failures.length} falha(s)`
                    : ""
                }`
              : `${lastRevertResult.revertedCount} tweak(s) restored to original state${
                  lastRevertResult.failures.length > 0
                    ? ` · ${lastRevertResult.failures.length} failure(s)`
                    : ""
                }`}
          </AlertTitle>
          {lastRevertResult.failures.length > 0 && (
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {lastRevertResult.failures.map((f) => (
                  <li key={f.tweakId}>
                    <span className="font-bold">
                      {localizeTweakTitle(f.tweakId, f.tweakTitle, locale)}:
                    </span>{" "}
                    {f.error}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          )}
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>
            {isPt ? "Erro" : "Error"} [{error.code}]
          </AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="overflow-hidden py-0 lg:col-span-5">
          <div className="flex items-center gap-2 border-b-2 border-border bg-main/15 px-4 py-3">
            <History className="size-4" aria-hidden="true" />
            <span className="font-heading text-sm font-bold">
              {isPt ? "Histórico de sessões" : "Session History"}
            </span>
          </div>

          {loading ? (
            <div className="p-5 text-xs text-foreground/75">
              {isPt
                ? "Carregando snapshots em disco..."
                : "Loading snapshots from disk..."}
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-5">
              <div className="font-heading text-sm font-bold">
                {isPt ? "Nenhum snapshot gravado" : "No snapshots recorded"}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-foreground/75">
                {isPt
                  ? "Assim que você aplicar um lote em Tweaks, o estado original será gravado automaticamente aqui para reversão segura."
                  : "As soon as you apply a batch in Tweaks or NetLab, the original state is saved here automatically for safe rollback."}
              </p>
            </div>
          ) : (
            <div className="divide-y-2 divide-border">
              {sessions.map((session) => {
                const isSelected =
                  selectedSession?.sessionId === session.sessionId;
                return (
                  <button
                    key={session.sessionId}
                    type="button"
                    onClick={() => handleSelectSession(session.sessionId)}
                    className={`flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      isSelected
                        ? "bg-main/20"
                        : "bg-secondary-background hover:bg-background/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-heading text-xs font-bold">
                        {session.label}
                      </span>
                      <Badge variant={session.restoredAt ? "safe" : "default"}>
                        {session.restoredAt
                          ? isPt
                            ? "Restaurado"
                            : "Restored"
                          : isPt
                            ? "Ativo"
                            : "Active"}
                      </Badge>
                    </div>
                    <div className="nb-mono flex items-center justify-between text-[11px] text-foreground/75">
                      <span>{formatTimestamp(session.createdAt, locale)}</span>
                      <span>
                        {session.tweakCount}{" "}
                        {session.tweakCount === 1 ? "tweak" : "tweaks"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              {isPt ? "Inspetor de sessão" : "Session Inspector"}
            </CardTitle>

            {selectedSession && selectedSession.restoredAt === null && (
              <div className="flex items-center gap-2">
                {confirmSessionId === selectedSession.sessionId ? (
                  <>
                    <Button
                      type="button"
                      variant="neutral"
                      size="xs"
                      onClick={() => setConfirmSessionId(null)}
                      disabled={busy}
                    >
                      {isPt ? "Cancelar" : "Cancel"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={handleConfirmRevert}
                      disabled={!canRevertSelected}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      <span>
                        {isPt ? "Confirmar reversão" : "Confirm rollback"}
                      </span>
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() =>
                      setConfirmSessionId(selectedSession.sessionId)
                    }
                    disabled={!canRevertSelected}
                    title={
                      isAdmin
                        ? isPt
                          ? "Restaurar todos os valores originais desta sessão"
                          : "Restore all original values from this session"
                        : isPt
                          ? "Requer execução como Administrador"
                          : "Requires Administrator privileges"
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    <span>{isPt ? "Reverter sessão" : "Revert session"}</span>
                  </Button>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent>
            {loadingSession ? (
              <p className="text-xs text-foreground/75">
                {isPt
                  ? "Lendo arquivo JSON do snapshot..."
                  : "Reading snapshot JSON file..."}
              </p>
            ) : !selectedSession ? (
              <p className="text-xs leading-relaxed text-foreground/75">
                {isPt
                  ? "Selecione uma sessão na lista à esquerda para inspecionar chaves de Registro, serviços e configurações originais preservadas."
                  : "Select a session on the left to inspect preserved Registry keys, services, and original system settings."}
              </p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-base border-2 border-border bg-background p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-heading font-bold">
                      {selectedSession.label}
                    </span>
                    {selectedSession.restoredAt && (
                      <Badge variant="safe">
                        <CheckCircle2 className="size-3" aria-hidden="true" />
                        <span>
                          {isPt ? "Restaurado em" : "Restored at"}{" "}
                          {formatTimestamp(selectedSession.restoredAt, locale)}
                        </span>
                      </Badge>
                    )}
                  </div>
                  <div className="nb-mono mt-1 text-[11px] text-foreground/75">
                    ID: {selectedSession.sessionId}
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedSession.entries.map((entry) => {
                    const entryRestored =
                      Boolean(selectedSession.restoredAt) ||
                      Boolean(entry.restoredAt);
                    return (
                      <div
                        key={entry.tweakId}
                        className="rounded-base border-2 border-border bg-background p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-heading text-xs font-bold">
                              {localizeTweakTitle(
                                entry.tweakId,
                                entry.tweakTitle,
                                locale
                              )}
                            </span>
                            <span className="nb-mono text-[11px] text-foreground/70">
                              {entry.tweakId}
                            </span>
                            {entryRestored && (
                              <Badge variant="safe">
                                {isPt ? "Restaurado" : "Restored"}
                              </Badge>
                            )}
                          </div>

                          {!entryRestored && onRevertSingleTweak && (
                            <Button
                              type="button"
                              variant="neutral"
                              size="xs"
                              disabled={!isAdmin || busy}
                              onClick={() =>
                                onRevertSingleTweak(
                                  entry.tweakId,
                                  selectedSession.sessionId
                                )
                              }
                            >
                              <RotateCcw
                                className="size-3"
                                aria-hidden="true"
                              />
                              <span>
                                {isPt ? "Reverter item" : "Revert item"}
                              </span>
                            </Button>
                          )}
                        </div>
                        <ul className="mt-2 space-y-1.5">
                          {entry.targets.map((target, idx) => (
                            <li
                              key={idx}
                              className="nb-mono break-all rounded-base border-2 border-border bg-secondary-background px-2.5 py-1.5 text-[11px]"
                            >
                              {describeTarget(target, locale)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

function describeOriginalRegistryValue(
  original: RegistryOriginalValue,
  locale: AppLocale = "pt"
): string {
  switch (original.kind) {
    case "absent":
      return locale === "pt" ? "ausente" : "absent";
    case "dword":
      return `REG_DWORD(${original.value})`;
    case "qword":
      return `REG_QWORD(${original.value})`;
    case "string":
      return `REG_SZ("${original.value}")`;
    case "expandString":
      return `REG_EXPAND_SZ("${original.value}")`;
    case "binary":
      return `REG_BINARY(${original.value.length} bytes)`;
    case "multiString":
      return `REG_MULTI_SZ([${original.value.join(", ")}])`;
  }
}

export function describeTarget(
  target: BackupTarget,
  locale: AppLocale = "pt"
): string {
  const isPt = locale === "pt";
  switch (target.targetType) {
    case "registryValue": {
      const hive = target.hive.toUpperCase();
      return `${hive}\\${target.subkey} :: ${target.valueName} -> original: ${describeOriginalRegistryValue(target.original, locale)}`;
    }
    case "serviceStartType":
      return isPt
        ? `Serviço ${target.serviceName} -> startType=${target.originalStartType}, emExecução=${target.wasRunning}`
        : `Service ${target.serviceName} -> startType=${target.originalStartType}, wasRunning=${target.wasRunning}`;
    case "powerPlan":
      return isPt
        ? `Plano de energia -> ${target.originalSchemeName} (${target.originalSchemeGuid})`
        : `Power plan -> ${target.originalSchemeName} (${target.originalSchemeGuid})`;
    case "powerSettingValue":
      return `PowerCfg ${target.subgroupGuid}/${target.settingGuid} -> AC=${target.originalAcIndex}, DC=${target.originalDcIndex}`;
    case "hibernationState":
      return isPt
        ? `Hibernação -> original=${target.wasEnabled ? "ativada" : "desativada"}`
        : `Hibernation -> original=${target.wasEnabled ? "enabled" : "disabled"}`;
    case "fsutilBehavior":
      return `fsutil behavior ${target.key} -> original=${target.originalValue}`;
    case "netshTcpGlobal":
      return `netsh int tcp global ${target.setting} -> original=${target.originalValue}`;
    case "netshIpGlobal":
      return `netsh int ${target.family} global ${target.setting} -> original=${target.originalValue}`;
    case "netshSupplementalTcp":
      return `netsh int tcp supplemental (${target.template}) -> original=${target.originalProvider}`;
    case "netAdapterDns":
      return isPt
        ? `DNS ${target.interfaceAlias} -> dhcp=${target.wasDhcp}, servidores=[${target.originalServers.join(", ")}]`
        : `DNS ${target.interfaceAlias} -> dhcp=${target.wasDhcp}, servers=[${target.originalServers.join(", ")}]`;
    case "scheduledTaskState":
      return isPt
        ? `Tarefa Agendada ${target.taskPath} -> original=${target.wasEnabled ? "ativada" : "desativada"}`
        : `Scheduled Task ${target.taskPath} -> original=${target.wasEnabled ? "enabled" : "disabled"}`;
    case "netInterfaceMtu":
      return `MTU ${target.interfaceAlias} -> original=${target.originalMtu} bytes`;
    case "qosPolicy":
      return isPt
        ? `Política QoS DSCP 46 -> HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\QoS\\${target.policyName}`
        : `QoS DSCP 46 Policy -> HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\QoS\\${target.policyName}`;
    case "snapshotNote":
      return `${target.description}: ${target.originalValue}`;
  }
}
