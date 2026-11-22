import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppError,
  ApplyTweaksResult,
  BackupSession,
  BackupSessionSummary,
  BenchmarkSnapshot,
  PrivilegeStatus,
  RevertSessionResult,
  StartupItem,
  StartupToggleResult,
  SystemScanReport,
  TelemetryTick,
  TweakItem,
  TweakProgressEvent,
} from "../types/system";

export function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

export function normalizeAppError(err: unknown): AppError {
  if (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err
  ) {
    const candidate = err as Partial<AppError>;
    return {
      code: candidate.code ?? "INVALID_OPERATION",
      message: String(candidate.message ?? "Erro desconhecido na camada nativa."),
      detail: candidate.detail ?? null,
    };
  }

  if (err instanceof Error) {
    return {
      code: "INVALID_OPERATION",
      message: err.message,
      detail: null,
    };
  }

  return {
    code: "INVALID_OPERATION",
    message: typeof err === "string" ? err : "Falha inesperada na chamada IPC.",
    detail: null,
  };
}

async function invokeTyped<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriRuntime()) {
    throw {
      code: "INVALID_OPERATION",
      message:
        "Runtime Tauri indisponível. Execute o aplicativo pela janela desktop (npm run tauri dev).",
      detail: `Comando bloqueado fora do WebView nativo: ${command}`,
    } satisfies AppError;
  }

  try {
    return await invoke<T>(command, args);
  } catch (err) {
    throw normalizeAppError(err);
  }
}

export const tauriClient = {
  getPrivilegeStatus(): Promise<PrivilegeStatus> {
    return invokeTyped<PrivilegeStatus>("get_privilege_status");
  },

  requestAdminElevation(): Promise<void> {
    return invokeTyped<void>("request_admin_elevation");
  },

  runSystemScan(): Promise<SystemScanReport> {
    return invokeTyped<SystemScanReport>("run_system_scan");
  },

  runSystemBenchmark(): Promise<BenchmarkSnapshot> {
    return invokeTyped<BenchmarkSnapshot>("run_system_benchmark");
  },

  listBackups(): Promise<BackupSessionSummary[]> {
    return invokeTyped<BackupSessionSummary[]>("list_backups");
  },

  getBackupSession(sessionId: string): Promise<BackupSession> {
    return invokeTyped<BackupSession>("get_backup_session", { sessionId });
  },

  getBackupDirectory(): Promise<string> {
    return invokeTyped<string>("get_backup_directory");
  },

  listTweaks(): Promise<TweakItem[]> {
    return invokeTyped<TweakItem[]>("list_tweaks");
  },

  applyTweaks(
    tweakIds: string[],
    sessionLabel?: string,
    createRestorePoint?: boolean
  ): Promise<ApplyTweaksResult> {
    return invokeTyped<ApplyTweaksResult>("apply_tweaks", {
      tweakIds,
      sessionLabel: sessionLabel ?? null,
      createRestorePoint: createRestorePoint ?? false,
    });
  },

  revertBackupSession(sessionId: string): Promise<RevertSessionResult> {
    return invokeTyped<RevertSessionResult>("revert_backup_session", {
      sessionId,
    });
  },

  revertSingleTweak(
    tweakId: string,
    sessionId?: string
  ): Promise<RevertSessionResult> {
    return invokeTyped<RevertSessionResult>("revert_single_tweak", {
      tweakId,
      sessionId: sessionId ?? null,
    });
  },

  listStartupItems(): Promise<StartupItem[]> {
    return invokeTyped<StartupItem[]>("list_startup_items");
  },

  setStartupItemEnabled(
    itemId: string,
    enabled: boolean
  ): Promise<StartupToggleResult> {
    return invokeTyped<StartupToggleResult>("set_startup_item_enabled", {
      itemId,
      enabled,
    });
  },

  onTelemetryTick(handler: (tick: TelemetryTick) => void): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
      return Promise.resolve(() => {});
    }
    return listen<TelemetryTick>("telemetry://tick", (event) => {
      handler(event.payload);
    });
  },

  onTweakProgress(
    handler: (evt: TweakProgressEvent) => void
  ): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
      return Promise.resolve(() => {});
    }
    return listen<TweakProgressEvent>("tweak://progress", (event) => {
      handler(event.payload);
    });
  },
};
