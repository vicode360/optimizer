import type { AppLocale } from "../types/system";

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  const precision = exponent === 0 ? 0 : decimals;
  return `${value.toFixed(precision)} ${units[exponent]}`;
}

export function formatBytesPerSec(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return "0 B/s";
  }
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

export function formatUptime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "0m";
  }
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function formatFrequencyMhz(mhz: number): string {
  if (!Number.isFinite(mhz) || mhz <= 0) {
    return "—";
  }
  if (mhz >= 1000) {
    return `${(mhz / 1000).toFixed(2)} GHz`;
  }
  return `${mhz} MHz`;
}

export function formatTimestamp(
  iso: string,
  locale: AppLocale = "pt"
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.0%";
  }
  return `${Math.max(0, Math.min(100, value)).toFixed(1)}%`;
}
