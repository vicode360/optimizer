import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { normalizeAppError, tauriClient } from "../services/tauriClient";
import type {
  AppError,
  AppLocale,
  UpdateCheckResult,
} from "../types/system";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface UpdateModalProps {
  open: boolean;
  locale: AppLocale;
  checking: boolean;
  updateInfo: UpdateCheckResult | null;
  checkError: AppError | null;
  onClose: () => void;
  onRecheck: () => void;
  onIgnoreVersion: (tag: string) => void;
}

export function UpdateModal({
  open,
  locale,
  checking,
  updateInfo,
  checkError,
  onClose,
  onRecheck,
  onIgnoreVersion,
}: UpdateModalProps) {
  const isPt = locale === "pt";
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<AppError | null>(null);
  const [launchedPath, setLaunchedPath] = useState<string | null>(null);

  if (!open) return null;

  const handleDownloadAndInstall = async () => {
    if (!updateInfo?.setupExeUrl || !updateInfo.setupExeName || downloading) {
      return;
    }
    setDownloading(true);
    setDownloadError(null);
    setLaunchedPath(null);
    try {
      const path = await tauriClient.downloadAndLaunchUpdate(
        updateInfo.setupExeUrl,
        updateInfo.sha256SumsUrl,
        updateInfo.setupExeName
      );
      setLaunchedPath(path);
    } catch (err) {
      setDownloadError(normalizeAppError(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isPt ? "Atualizações do Optimizer" : "Optimizer Updates"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <Card className="max-h-[85vh] w-full max-w-xl overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b-2 border-border bg-main/20 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-base border-2 border-border bg-main text-main-foreground">
              <Sparkles className="size-4" aria-hidden="true" />
            </div>
            <div>
              <CardTitle className="text-base">
                {isPt
                  ? "Central de Atualizações (GitHub Releases)"
                  : "Update Center (GitHub Releases)"}
              </CardTitle>
              <p className="nb-mono text-[11px] text-foreground/75">
                github.com/vicode360/optimizer
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="neutral"
            size="icon-xs"
            onClick={onClose}
            aria-label="Fechar modal de atualização"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </CardHeader>

        <CardContent className="space-y-4 overflow-y-auto py-5">
          {checking ? (
            <div className="flex items-center gap-3 rounded-base border-2 border-border bg-background p-4 text-xs">
              <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              <span className="font-heading font-bold">
                {isPt
                  ? "Consultando último release em github.com/vicode360/optimizer..."
                  : "Checking latest release on github.com/vicode360/optimizer..."}
              </span>
            </div>
          ) : checkError ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>[{checkError.code}]</AlertTitle>
              <AlertDescription>{checkError.message}</AlertDescription>
            </Alert>
          ) : updateInfo ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-base border-2 border-border bg-background p-3.5">
                <div className="space-y-0.5 text-xs">
                  <div className="text-foreground/70">
                    {isPt ? "Versão Instalada" : "Installed Version"}:{" "}
                    <strong className="nb-mono">
                      v{updateInfo.currentVersion}
                    </strong>
                  </div>
                  <div className="text-foreground/70">
                    {isPt ? "Último Release no GitHub" : "Latest GitHub Release"}
                    :{" "}
                    <strong className="nb-mono">
                      {updateInfo.releaseTag}
                    </strong>
                  </div>
                </div>

                <Badge
                  variant={updateInfo.updateAvailable ? "safe" : "neutral"}
                >
                  {updateInfo.updateAvailable
                    ? isPt
                      ? "Nova atualização disponível!"
                      : "New update available!"
                    : isPt
                      ? "Você já está na versão mais recente"
                      : "You are on the latest version"}
                </Badge>
              </div>

              {updateInfo.releaseNotes && (
                <div className="space-y-1.5">
                  <div className="font-heading text-xs font-bold uppercase text-foreground/75">
                    {isPt
                      ? `Notas da Versão (${updateInfo.releaseName})`
                      : `Release Notes (${updateInfo.releaseName})`}
                  </div>
                  <pre className="nb-mono max-h-48 overflow-y-auto whitespace-pre-wrap rounded-base border-2 border-border bg-background p-3 text-xs leading-relaxed">
                    {updateInfo.releaseNotes}
                  </pre>
                </div>
              )}

              {downloadError && (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>[{downloadError.code}]</AlertTitle>
                  <AlertDescription>{downloadError.message}</AlertDescription>
                </Alert>
              )}

              {launchedPath && (
                <Alert variant="success">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  <AlertTitle>
                    {isPt
                      ? "Instalador verificado (SHA-256) e iniciado!"
                      : "Installer verified (SHA-256) and launched!"}
                  </AlertTitle>
                  <AlertDescription className="nb-mono break-all text-xs">
                    {launchedPath}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-border pt-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="neutral"
                    size="xs"
                    onClick={onRecheck}
                    disabled={downloading}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    <span>
                      {isPt ? "Verificar Novamente" : "Check Again"}
                    </span>
                  </Button>

                  {updateInfo.updateAvailable && (
                    <Button
                      type="button"
                      variant="neutral"
                      size="xs"
                      onClick={() => {
                        onIgnoreVersion(updateInfo.releaseTag);
                        onClose();
                      }}
                      disabled={downloading}
                    >
                      <span>
                        {isPt ? "Ignorar esta versão" : "Skip this version"}
                      </span>
                    </Button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={updateInfo.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background px-3 text-xs font-heading font-bold text-foreground shadow-shadow transition-all hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none"
                  >
                    <ExternalLink className="size-3.5" aria-hidden="true" />
                    <span>GitHub Release</span>
                  </a>

                  {updateInfo.updateAvailable && updateInfo.setupExeUrl && (
                    <Button
                      type="button"
                      variant="success"
                      size="sm"
                      onClick={() => void handleDownloadAndInstall()}
                      disabled={downloading}
                    >
                      {downloading ? (
                        <RefreshCw
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Download className="size-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {downloading
                          ? isPt
                            ? "Baixando & Verificando SHA-256..."
                            : "Downloading & Verifying SHA-256..."
                          : isPt
                            ? "Atualizar Agora (SHA-256)"
                            : "Update Now (SHA-256)"}
                      </span>
                    </Button>
                  )}
                </div>
              </div>

              {updateInfo.sha256SumsUrl && (
                <div className="flex items-center gap-1.5 text-[11px] text-foreground/70">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  <span>
                    {isPt
                      ? "Integridade do instalador validada automaticamente contra o arquivo SHA256SUMS.txt oficial antes da execução."
                      : "Installer integrity is automatically verified against the official SHA256SUMS.txt before execution."}
                  </span>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
