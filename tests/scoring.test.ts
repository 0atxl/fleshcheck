import { describe, expect, it } from "vitest";
import { CaseFileStore, type StorageLike } from "../src/game/case-file";
import { computeHumanPct, formatShareLine, formatTrySquare } from "../src/game/scoring";

describe("scoring and case-file persistence", () => {
  it("caps failed runs at 99% and keeps scores within [0, 100]", () => {
    expect(computeHumanPct(-0.4, "failed")).toBe(0);
    expect(computeHumanPct(0.5, "failed")).toBe(50);
    expect(computeHumanPct(0.999, "failed")).toBe(99);
    expect(computeHumanPct(1, "failed")).toBe(99);
    expect(computeHumanPct(1, "passed")).toBe(100);
  });

  it("attaches warning suffix on paused tries without replacing pass/fail square", () => {
    expect(formatTrySquare({ passed: false, pct: 40, paused: true })).toBe("🟥⚠️");
    expect(formatTrySquare({ passed: true, pct: 100, paused: true })).toBe("🟩⚠️");
    expect(formatTrySquare({ passed: false, pct: 30, paused: false })).toBe("🟥");
    expect(formatTrySquare({ passed: true, pct: 100, paused: false })).toBe("🟩");
  });

  it("formats Wordle-style share lines with attached pause badges and replay label", () => {
    const line = formatShareLine({
      dayNumber: 4,
      title: "Poker Face",
      tries: [
        { passed: false, pct: 20, paused: true },
        { passed: false, pct: 45, paused: false },
        { passed: true, pct: 100, paused: false },
      ],
      bestPct: 100,
      site: "fleshcheck.app",
    });

    expect(line).toBe("FLESHCHECK #04 · POKER FACE · 🟥⚠️🟥🟩 · 100% HUMAN\nfleshcheck.app");

    const replayLine = formatShareLine({
      dayNumber: 2,
      title: "Poker Face",
      tries: [{ passed: false, pct: 61, paused: false }],
      bestPct: 61,
      isReplay: true,
      site: "fleshcheck.app",
    });
    expect(replayLine).toContain("FLESHCHECK #02 (replay)");
  });

  it("persists today's tries, blocks replays from consuming daily budget, and survives broken storage", () => {
    const backing = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => backing.set(k, v),
    };

    const store = new CaseFileStore(storage);
    store.recordVerdict("POKER_FACE", 5, { passed: false, pct: 35, paused: true }, false);
    expect(store.getTodayTries(5)).toHaveLength(1);
    expect(store.isTodayFinished(5)).toBe(false);

    // Replay on day 3 must not affect day 5 daily tries
    store.recordVerdict("POKER_FACE", 3, { passed: true, pct: 100, paused: false }, true);
    expect(store.getTodayTries(5)).toHaveLength(1);
    expect(store.getDepartmentStatus("POKER_FACE").verdict).toBe("CLEARED");

    // Passing today ends today
    store.recordVerdict("POKER_FACE", 5, { passed: true, pct: 100, paused: false }, false);
    expect(store.isTodayFinished(5)).toBe(true);
    expect(store.getData().streak).toBe(1);

    // Broken storage falls back to in-memory cleanly
    const throwingStorage: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const memStore = new CaseFileStore(throwingStorage);
    memStore.recordVerdict("POKER_FACE", 5, { passed: false, pct: 40, paused: false }, false);
    expect(memStore.getTodayTries(5)).toHaveLength(1);
  });
});
