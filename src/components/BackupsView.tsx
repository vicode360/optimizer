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
import type {
  AppError,
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
  progress: TweakProgressEvent | null;
  lastRevertResult: RevertSessionResult | null;
  error: AppError | null;
  privilege: PrivilegeStatus | null;
  privilegeLoading?: boolean;
  onRefresh: () => void;
  onInspectSession: (sessionId: string) => void;
  onRevertSession: (sessionId: string) => void;
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
  progress,
  lastRevertResult,
  error,
  privilege,
  privilegeLoading = false,
  onRefresh,
  onInspectSession,
  onRevertSession,
  onRequestElevation,
}: BackupsViewProps) {
  const [confirmSessionId, setConfirmSessionId] = useState<string | null>(null);

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
                  Cofre de snapshots atômicos
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-foreground/80">
                  Toda mutação de Registro, Serviços, Plano de Energia, TCP/IP
                  ou NTFS grava primeiro o estado original em disco antes de
                  alterar o Windows.
                </p>
                <div className="nb-mono mt-2.5 inline-block break-all rounded-base border-2 border-border bg-background px-3 py-1 text-xs font-bold">
                  {directory ?? "Resolvendo %AppData%/optimizer/backups..."}
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
              <span>Atualizar lista</span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t-2 border-border pt-3.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={isAdmin ? "safe" : "moderate"}>
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>
                  Token:{" "}
                  {privilegeLoading
                    ? "Verificando..."
                    : (privilege?.elevationLabel ?? "Indisponível")}
                </span>
              </Badge>
              <Badge variant="neutral" className="nb-mono">
                Sessões gravadas: {sessions.length}
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
                {elevating ? "Aguardando UAC..." : "Reiniciar como Administrador"}
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
            {lastRevertResult.revertedCount} tweak(s) restaurados para o estado
            original
            {lastRevertResult.failures.length > 0
              ? ` · ${lastRevertResult.failures.length} falha(s)`
              : ""}
          </AlertTitle>
          {lastRevertResult.failures.length > 0 && (
            <AlertDescription>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                {lastRevertResult.failures.map((f) => (
                  <li key={f.tweakId}>
                    <span className="font-bold">{f.tweakTitle}:</span> {f.error}
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
          <AlertTitle>Erro [{error.code}]</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <Card className="overflow-hidden py-0 lg:col-span-5">
          <div className="flex items-center gap-2 border-b-2 border-border bg-main/15 px-4 py-3">
            <History className="size-4" aria-hidden="true" />
            <span className="font-heading text-sm font-bold">
              Histórico de sessões
            </span>
          </div>

          {loading ? (
            <div className="p-5 text-xs text-foreground/75">
              Carregando snapshots em disco...
            </div>
          ) : sessions.length === 0 ? (
            <div className="p-5">
              <div className="font-heading text-sm font-bold">
                Nenhum snapshot gravado
              </div>
              <p className="mt-1 text-xs leading-relaxed text-foreground/75">
                Assim que você aplicar um lote em Tweaks, o estado original será
                gravado automaticamente aqui para reversão segura.
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
                        {session.restoredAt ? "Restaurado" : "Ativo"}
                      </Badge>
                    </div>
                    <div className="nb-mono flex items-center justify-between text-[11px] text-foreground/75">
                      <span>{formatTimestamp(session.createdAt)}</span>
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
            <CardTitle className="text-base">Inspetor de sessão</CardTitle>

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
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      onClick={handleConfirmRevert}
                      disabled={!canRevertSelected}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      <span>Confirmar reversão</span>
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
                        ? "Restaurar todos os valores originais desta sessão"
                        : "Requer execução como Administrador"
                    }
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    <span>Reverter sessão</span>
                  </Button>
                )}
              </div>
            )}
          </CardHeader>

          <CardContent>
            {loadingSession ? (
              <p className="text-xs text-foreground/75">
                Lendo arquivo JSON do snapshot...
              </p>
            ) : !selectedSession ? (
              <p className="text-xs leading-relaxed text-foreground/75">
                Selecione uma sessão na lista à esquerda para inspecionar chaves
                de Registro, serviços e configurações originais preservadas.
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
                          Restaurado em{" "}
                          {formatTimestamp(selectedSession.restoredAt)}
                        </span>
                      </Badge>
                    )}
                  </div>
                  <div className="nb-mono mt-1 text-[11px] text-foreground/75">
                    ID: {selectedSession.sessionId}
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedSession.entries.map((entry) => (
                    <div
                      key={entry.tweakId}
                      className="rounded-base border-2 border-border bg-background p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-heading text-xs font-bold">
                          {entry.tweakTitle}
                        </span>
                        <span className="nb-mono text-[11px] text-foreground/70">
                          {entry.tweakId}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {entry.targets.map((target, idx) => (
                          <li
                            key={idx}
                            className="nb-mono break-all rounded-base border-2 border-border bg-secondary-background px-2.5 py-1.5 text-[11px]"
                          >
                            {describeTarget(target)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
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
  original: RegistryOriginalValue
): string {
  switch (original.kind) {
    case "absent":
      return "ausente";
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

export function describeTarget(target: BackupTarget): string {
  switch (target.targetType) {
    case "registryValue": {
      const hive = target.hive.toUpperCase();
      return `${hive}\\${target.subkey} :: ${target.valueName} -> original: ${describeOriginalRegistryValue(target.original)}`;
    }
    case "serviceStartType":
      return `Serviço ${target.serviceName} -> startType=${target.originalStartType}, emExecução=${target.wasRunning}`;
    case "powerPlan":
      return `Plano de energia -> ${target.originalSchemeName} (${target.originalSchemeGuid})`;
    case "powerSettingValue":
      return `PowerCfg ${target.subgroupGuid}/${target.settingGuid} -> AC=${target.originalAcIndex}, DC=${target.originalDcIndex}`;
    case "hibernationState":
      return `Hibernação -> original=${target.wasEnabled ? "ativada" : "desativada"}`;
    case "fsutilBehavior":
      return `fsutil behavior ${target.key} -> original=${target.originalValue}`;
    case "netshTcpGlobal":
      return `netsh int tcp global ${target.setting} -> original=${target.originalValue}`;
    case "netshIpGlobal":
      return `netsh int ${target.family} global ${target.setting} -> original=${target.originalValue}`;
    case "netshSupplementalTcp":
      return `netsh int tcp supplemental (${target.template}) -> original=${target.originalProvider}`;
    case "netAdapterDns":
      return `DNS ${target.interfaceAlias} -> dhcp=${target.wasDhcp}, servidores=[${target.originalServers.join(", ")}]`;
    case "snapshotNote":
      return `${target.description}: ${target.originalValue}`;
  }
}
