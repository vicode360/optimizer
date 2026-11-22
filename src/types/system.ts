export type AppErrorCode =
  | "ADMIN_REQUIRED"
  | "IO_ERROR"
  | "SERDE_ERROR"
  | "WINDOWS_API_ERROR"
  | "BACKUP_ERROR"
  | "INVALID_OPERATION";

export interface AppError {
  code: AppErrorCode;
  message: string;
  detail: string | null;
}

export interface PrivilegeStatus {
  isAdmin: boolean;
  elevationLabel: string;
  username: string;
}

export type RegistryHive = "hklm" | "hkcu";

export type RegistryOriginalValue =
  | { kind: "dword"; value: number }
  | { kind: "qword"; value: number }
  | { kind: "string"; value: string }
  | { kind: "expandString"; value: string }
  | { kind: "binary"; value: number[] }
  | { kind: "multiString"; value: string[] }
  | { kind: "absent" };

export type BackupTarget =
  | {
      targetType: "registryValue";
      hive: RegistryHive;
      subkey: string;
      valueName: string;
      original: RegistryOriginalValue;
    }
  | {
      targetType: "serviceStartType";
      serviceName: string;
      originalStartType: number;
      wasRunning: boolean;
    }
  | {
      targetType: "powerPlan";
      originalSchemeGuid: string;
      originalSchemeName: string;
    }
  | {
      targetType: "powerSettingValue";
      schemeGuid: string;
      subgroupGuid: string;
      settingGuid: string;
      originalAcIndex: number;
      originalDcIndex: number;
    }
  | {
      targetType: "hibernationState";
      wasEnabled: boolean;
    }
  | {
      targetType: "fsutilBehavior";
      key: string;
      originalValue: number;
    }
  | {
      targetType: "netshTcpGlobal";
      setting: string;
      originalValue: string;
    }
  | {
      targetType: "netshIpGlobal";
      family: string;
      setting: string;
      originalValue: string;
    }
  | {
      targetType: "netshSupplementalTcp";
      template: string;
      originalProvider: string;
    }
  | {
      targetType: "netAdapterDns";
      interfaceAlias: string;
      wasDhcp: boolean;
      originalServers: string[];
    }
  | {
      targetType: "snapshotNote";
      description: string;
      originalValue: string;
    };

export interface BackupEntry {
  tweakId: string;
  tweakTitle: string;
  targets: BackupTarget[];
}

export interface BackupSession {
  sessionId: string;
  createdAt: string;
  restoredAt: string | null;
  label: string;
  entries: BackupEntry[];
}

export interface BackupSessionSummary {
  sessionId: string;
  createdAt: string;
  restoredAt: string | null;
  label: string;
  tweakCount: number;
  filePath: string;
}

export interface OsInfo {
  name: string;
  version: string;
  hostname: string;
  arch: string;
  uptimeSeconds: number;
}

export interface CpuInfo {
  brand: string;
  physicalCores: number;
  logicalCores: number;
  frequencyMhz: number;
  usagePercent: number;
}

export interface MemoryInfo {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
}

export interface GpuInfo {
  name: string;
  driverVersion: string;
  vramBytes: number;
  status: string;
}

export interface DiskInfo {
  name: string;
  mountPoint: string;
  fileSystem: string;
  kind: string;
  totalBytes: number;
  availableBytes: number;
  isRemovable: boolean;
}

export interface NetworkAdapterInfo {
  name: string;
  macAddress: string;
  totalReceivedBytes: number;
  totalTransmittedBytes: number;
}

export interface PowerPlanInfo {
  guid: string;
  name: string;
}

export interface HardwareSummary {
  os: OsInfo;
  cpu: CpuInfo;
  memory: MemoryInfo;
  gpus: GpuInfo[];
  disks: DiskInfo[];
  networks: NetworkAdapterInfo[];
  powerPlan: PowerPlanInfo;
}

export interface MonitorInfo {
  deviceName: string;
  adapterString: string;
  width: number;
  height: number;
  refreshRateHz: number;
  isPrimary: boolean;
}

export interface InputDeviceInfo {
  name: string;
  manufacturer: string;
  deviceId: string;
  status: string;
}

export interface PeripheralsSummary {
  monitors: MonitorInfo[];
  mice: InputDeviceInfo[];
  keyboards: InputDeviceInfo[];
}

export type DiagnosticSeverity = "optimal" | "info" | "warning" | "critical";

export interface DiagnosticFinding {
  id: string;
  title: string;
  detail: string;
  severity: DiagnosticSeverity;
  recommendedTweakIds: string[];
}

export interface SystemScanReport {
  scannedAt: string;
  hardware: HardwareSummary;
  peripherals: PeripheralsSummary;
  diagnostics: DiagnosticFinding[];
}

export interface TelemetryTick {
  timestamp: string;
  cpuUsagePercent: number;
  cpuPerCorePercent: number[];
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryPercent: number;
  networkRxBytesPerSec: number;
  networkTxBytesPerSec: number;
  uptimeSeconds: number;
}

export type TweakCategory =
  | "gaming"
  | "gpu"
  | "network"
  | "power"
  | "input"
  | "debloat"
  | "security";

export type TweakRisk = "safe" | "moderate" | "advanced";

export type TweakImpact = "low" | "medium" | "high";

export interface TweakItem {
  id: string;
  title: string;
  description: string;
  technicalDetail: string;
  benchmarkNote: string;
  category: TweakCategory;
  impact: TweakImpact;
  risk: TweakRisk;
  requiresAdmin: boolean;
  reversible: boolean;
  applied: boolean;
  applicable: boolean;
  hardwareNote: string | null;
}

export interface TweakProgressEvent {
  phase: "backingUp" | "applying" | "reverting" | "completed" | "failed" | string;
  current: number;
  total: number;
  tweakId: string | null;
  tweakTitle: string | null;
  message: string;
  sessionId: string | null;
}

export interface TweakOperationFailure {
  tweakId: string;
  tweakTitle: string;
  error: string;
}

export interface ApplyTweaksResult {
  sessionId: string;
  backupPath: string;
  appliedIds: string[];
  failures: TweakOperationFailure[];
}

export interface RevertSessionResult {
  sessionId: string;
  revertedCount: number;
  failures: TweakOperationFailure[];
  markedRestored: boolean;
}

export type ActiveSection =
  | "diagnostics"
  | "hardware"
  | "telemetry"
  | "backups"
  | "tweaks";
