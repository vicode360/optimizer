import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatBytesPerSec,
  formatFrequencyMhz,
  formatPercent,
  formatTimestamp,
  formatUptime,
} from "../utils/format";

describe("format utilities", () => {
  it("formats bytes safely including zero, negative, and non-finite inputs", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-50)).toBe("0 B");
    expect(formatBytes(Number.NaN)).toBe("0 B");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KiB");
    expect(formatBytes(1024 * 1024 * 1024 * 16)).toBe("16.0 GiB");
  });

  it("formats throughput per second", () => {
    expect(formatBytesPerSec(0)).toBe("0 B/s");
    expect(formatBytesPerSec(2048)).toBe("2.0 KiB/s");
  });

  it("formats uptime across minutes, hours, and days", () => {
    expect(formatUptime(0)).toBe("0m");
    expect(formatUptime(180)).toBe("3m");
    expect(formatUptime(3660)).toBe("1h 1m");
    expect(formatUptime(90060)).toBe("1d 1h 1m");
  });

  it("formats frequencies and percentages with clamping", () => {
    expect(formatFrequencyMhz(0)).toBe("—");
    expect(formatFrequencyMhz(800)).toBe("800 MHz");
    expect(formatFrequencyMhz(4200)).toBe("4.20 GHz");

    expect(formatPercent(Number.NaN)).toBe("0.0%");
    expect(formatPercent(-5)).toBe("0.0%");
    expect(formatPercent(145)).toBe("100.0%");
    expect(formatPercent(42.34)).toBe("42.3%");
  });

  it("returns original input on invalid ISO timestamps", () => {
    expect(formatTimestamp("invalid-date")).toBe("invalid-date");
    expect(formatTimestamp("2026-01-15T10:30:00Z")).toContain("2026");
  });
});
