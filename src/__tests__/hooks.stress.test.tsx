import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBackups } from "../hooks/useBackups";
import { useTweaks } from "../hooks/useTweaks";
import { tauriClient } from "../services/tauriClient";
import type { BackupSession, TweakItem } from "../types/system";

vi.mock("../services/tauriClient", () => ({
  normalizeAppError: (err: unknown) => ({
    code: "INVALID_OPERATION",
    message: err instanceof Error ? err.message : String(err),
    detail: null,
  }),
  tauriClient: {
    listTweaks: vi.fn(),
    applyTweaks: vi.fn(),
    revertBackupSession: vi.fn(),
    onTweakProgress: vi.fn(),
    getBackupDirectory: vi.fn(),
    listBackups: vi.fn(),
    getBackupSession: vi.fn(),
  },
}));

const mockedClient = vi.mocked(tauriClient);

function makeTweak(id: string): TweakItem {
  return {
    id,
    title: `Tweak ${id}`,
    description: "Real test tweak",
    technicalDetail: `HKLM\\Software\\Test :: ${id}=1`,
    benchmarkNote: "Benchmark reference",
    category: "gaming",
    impact: "high",
    risk: "safe",
    requiresAdmin: true,
    reversible: true,
    applied: false,
    applicable: true,
    hardwareNote: null,
  };
}

describe("hooks stress and race-condition guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedClient.onTweakProgress.mockResolvedValue(() => {});
    mockedClient.listTweaks.mockResolvedValue([
      makeTweak("t1"),
      makeTweak("t2"),
      makeTweak("t3"),
    ]);
  });

  it("prevents concurrent applySelected calls (double-click lock) and keeps failed IDs selected", async () => {
    let resolveApply!: (val: Awaited<ReturnType<typeof tauriClient.applyTweaks>>) => void;
    mockedClient.applyTweaks.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve;
        })
    );

    const onMutationComplete = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTweaks({ onMutationComplete }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setSelected(["t1", "t2"]);
    });

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => {
      p1 = result.current.applySelected("Batch 1");
      p2 = result.current.applySelected("Batch 1 duplicate");
    });

    expect(mockedClient.applyTweaks).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveApply({
        sessionId: "sess-1",
        backupPath: "C:\\backups\\sess-1.json",
        appliedIds: ["t1"],
        failures: [
          {
            tweakId: "t2",
            tweakTitle: "Tweak t2",
            error: "Access denied",
          },
        ],
      });
      await Promise.all([p1, p2]);
    });

    // t1 succeeded and was deselected; t2 failed and remains selected for retry
    expect(result.current.selectedIds).toEqual(["t2"]);
    expect(onMutationComplete).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(false);
  });

  it("batches revertAllSessions and runs refresh + onMutationComplete only once", async () => {
    mockedClient.revertBackupSession.mockResolvedValue({
      sessionId: "s",
      revertedCount: 2,
      failures: [],
      markedRestored: true,
    });

    const onMutationComplete = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTweaks({ onMutationComplete }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedClient.listTweaks.mockClear();

    await act(async () => {
      const aggregated = await result.current.revertAllSessions([
        "sess-3",
        "sess-2",
        "sess-1",
      ]);
      expect(aggregated?.revertedCount).toBe(6);
      expect(aggregated?.markedRestored).toBe(true);
    });

    expect(mockedClient.revertBackupSession).toHaveBeenCalledTimes(3);
    expect(mockedClient.listTweaks).toHaveBeenCalledTimes(1);
    expect(onMutationComplete).toHaveBeenCalledTimes(1);
  });

  it("ignores stale out-of-order inspectSession responses in useBackups", async () => {
    mockedClient.getBackupDirectory.mockResolvedValue("C:\\backups");
    mockedClient.listBackups.mockResolvedValue([]);

    let resolveSlowA!: (val: BackupSession) => void;
    let resolveFastB!: (val: BackupSession) => void;

    mockedClient.getBackupSession.mockImplementation((id: string) => {
      if (id === "session-A") {
        return new Promise((resolve) => {
          resolveSlowA = resolve;
        });
      }
      return new Promise((resolve) => {
        resolveFastB = resolve;
      });
    });

    const { result } = renderHook(() => useBackups());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let pA!: Promise<void>;
    let pB!: Promise<void>;
    act(() => {
      pA = result.current.inspectSession("session-A");
      pB = result.current.inspectSession("session-B");
    });

    await act(async () => {
      resolveFastB({
        sessionId: "session-B",
        createdAt: "2026-01-02T00:00:00Z",
        restoredAt: null,
        label: "Session B",
        entries: [],
      });
      await pB;
    });
    expect(result.current.selectedSession?.sessionId).toBe("session-B");

    await act(async () => {
      resolveSlowA({
        sessionId: "session-A",
        createdAt: "2026-01-01T00:00:00Z",
        restoredAt: null,
        label: "Session A (stale)",
        entries: [],
      });
      await pA;
    });

    // Stale A must NOT overwrite newer B
    expect(result.current.selectedSession?.sessionId).toBe("session-B");
  });
});
