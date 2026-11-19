import { MAX_TRIES_PER_DAY, STORAGE_KEY } from "../config";
import { pickBestTry } from "./scoring";
import type { ChallengeId, TryRecord } from "./types";

export interface DepartmentStats {
  tries: number;
  passes: number;
  bestPct: number;
}

export type LastResultLabel = "cleared" | "rejected" | "absent";

export interface CaseFileData {
  streak: number;
  lastDay: number;
  lastResult?: LastResultLabel;
  today: {
    day: number;
    tries: TryRecord[];
    displaySquares?: TryRecord[];
  };
  departments: Partial<Record<ChallengeId, DepartmentStats>>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type DepartmentVerdict = "UNREVIEWED" | "REJECTED" | "CLEARED";

function emptyData(): CaseFileData {
  return {
    streak: 0,
    lastDay: 0,
    today: { day: 0, tries: [] },
    departments: {},
  };
}

function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Private browsing or blocked storage
  }
  return null;
}

const MAX_DISPLAY_SQUARES = 12;

function sanitizeTryRecord(item: unknown): TryRecord | null {
  if (!item || typeof item !== "object") return null;
  const candidate = item as Record<string, unknown>;
  if (typeof candidate.passed !== "boolean") return null;
  if (typeof candidate.pct !== "number" || !Number.isFinite(candidate.pct)) return null;
  return {
    passed: candidate.passed,
    pct: Math.max(0, Math.min(100, Math.round(candidate.pct))),
    paused: Boolean(candidate.paused),
  };
}

function sanitizeTryArray(arr: unknown, maxLen: number): TryRecord[] {
  if (!Array.isArray(arr)) return [];
  const out: TryRecord[] = [];
  for (const item of arr) {
    const clean = sanitizeTryRecord(item);
    if (clean) out.push(clean);
    if (out.length >= maxLen) break;
  }
  return out;
}

function sanitizeLastResult(val: unknown): LastResultLabel | undefined {
  if (val === "cleared" || val === "rejected" || val === "absent") return val;
  return undefined;
}

function deriveResultLabel(record: TryRecord): LastResultLabel {
  if (record.passed) return "cleared";
  return record.pct < 40 ? "absent" : "rejected";
}

function sanitizeDepartments(
  raw: unknown,
): Partial<Record<ChallengeId, DepartmentStats>> {
  if (!raw || typeof raw !== "object") return {};
  const result: Partial<Record<ChallengeId, DepartmentStats>> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const rec = val as Record<string, unknown>;
    const tries = typeof rec.tries === "number" && Number.isFinite(rec.tries) ? Math.max(0, Math.floor(rec.tries)) : 0;
    const passes = typeof rec.passes === "number" && Number.isFinite(rec.passes) ? Math.max(0, Math.floor(rec.passes)) : 0;
    const bestPct = typeof rec.bestPct === "number" && Number.isFinite(rec.bestPct) ? Math.max(0, Math.min(100, Math.round(rec.bestPct))) : 0;
    result[key as ChallengeId] = { tries, passes, bestPct };
  }
  return result;
}

/**
 * Manages local persistence of department records, daily tries, and streak.
 * Safely degrades to in-memory state when localStorage is unavailable.
 */
export class CaseFileStore {
  private memoryState: CaseFileData;
  private readonly storage: StorageLike | null;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? getBrowserStorage() : storage;
    this.memoryState = this.load();
  }

  private load(): CaseFileData {
    if (!this.storage) return emptyData();
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      const parsed = JSON.parse(raw) as Partial<CaseFileData>;
      const displaySquares = sanitizeTryArray(parsed.today?.displaySquares, MAX_DISPLAY_SQUARES);
      const lastResult = sanitizeLastResult(parsed.lastResult);
      return {
        streak:
          typeof parsed.streak === "number" && Number.isFinite(parsed.streak) && parsed.streak >= 0
            ? Math.floor(parsed.streak)
            : 0,
        lastDay:
          typeof parsed.lastDay === "number" && Number.isFinite(parsed.lastDay) && parsed.lastDay >= 0
            ? Math.floor(parsed.lastDay)
            : 0,
        ...(lastResult ? { lastResult } : {}),
        today: {
          day:
            typeof parsed.today?.day === "number" && Number.isFinite(parsed.today.day)
              ? Math.floor(parsed.today.day)
              : 0,
          tries: sanitizeTryArray(parsed.today?.tries, MAX_TRIES_PER_DAY),
          ...(displaySquares.length > 0 ? { displaySquares } : {}),
        },
        departments: sanitizeDepartments(parsed.departments),
      };
    } catch {
      return emptyData();
    }
  }

  private save(data: CaseFileData): void {
    this.memoryState = data;
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Ignore quota / private mode failures; memoryState remains current
    }
  }

  getData(): CaseFileData {
    return this.memoryState;
  }

  /**
   * Returns the live streak as of `todayDay`, dropping stale streaks when at
   * least one full UTC day was missed.
   */
  getEffectiveStreak(todayDay: number): number {
    const { streak, lastDay } = this.memoryState;
    if (streak <= 0 || lastDay <= 0) return 0;
    if (todayDay - lastDay > 1) return 0;
    return streak;
  }

  getTodayTries(dayNumber: number): TryRecord[] {
    if (this.memoryState.today.day !== dayNumber) {
      return [];
    }
    return [...this.memoryState.today.tries];
  }

  getTodayDisplaySquares(dayNumber: number): TryRecord[] {
    if (this.memoryState.today.day !== dayNumber) {
      return [];
    }
    const override = this.memoryState.today.displaySquares;
    return override && override.length > 0 ? [...override] : [...this.memoryState.today.tries];
  }

  isTodayFinished(dayNumber: number, maxTries = MAX_TRIES_PER_DAY): boolean {
    const tries = this.getTodayTries(dayNumber);
    if (tries.length === 0) return false;
    return tries.some((t) => t.passed) || tries.length >= maxTries;
  }

  getBestTodayTry(dayNumber: number): TryRecord | null {
    return pickBestTry(this.getTodayTries(dayNumber));
  }

  getDepartmentStatus(id: ChallengeId): {
    verdict: DepartmentVerdict;
    tries: number;
    passes: number;
    bestPct: number;
  } {
    const stats = this.memoryState.departments[id];
    if (!stats || stats.tries === 0) {
      return { verdict: "UNREVIEWED", tries: 0, passes: 0, bestPct: 0 };
    }
    return {
      verdict: stats.passes > 0 ? "CLEARED" : "REJECTED",
      tries: stats.tries,
      passes: stats.passes,
      bestPct: stats.bestPct,
    };
  }

  getTotalTries(): number {
    let total = 0;
    for (const stats of Object.values(this.memoryState.departments)) {
      if (stats) total += stats.tries;
    }
    return total;
  }

  getLastResult(): LastResultLabel | undefined {
    if (this.memoryState.lastResult) return this.memoryState.lastResult;
    const tries = this.memoryState.today.tries;
    if (tries.length > 0) {
      return deriveResultLabel(tries[tries.length - 1]!);
    }
    if (this.getTotalTries() > 0) {
      for (const stats of Object.values(this.memoryState.departments)) {
        if (stats && stats.passes > 0) return "cleared";
      }
      return "rejected";
    }
    return undefined;
  }

  /**
   * Records a try at verdict time.
   * Replay runs (?day=) never mutate today's 3-try budget or daily streak.
   */
  recordVerdict(
    challengeId: ChallengeId,
    dayNumber: number,
    record: TryRecord,
    isReplay: boolean,
    maxTries = MAX_TRIES_PER_DAY,
    displaySquares?: readonly TryRecord[],
  ): void {
    const next: CaseFileData = {
      streak: this.memoryState.streak,
      lastDay: this.memoryState.lastDay,
      lastResult: deriveResultLabel(record),
      today: {
        day: this.memoryState.today.day,
        tries: [...this.memoryState.today.tries],
        ...(this.memoryState.today.displaySquares
          ? { displaySquares: [...this.memoryState.today.displaySquares] }
          : {}),
      },
      departments: { ...this.memoryState.departments },
    };

    const prevDept = next.departments[challengeId] ?? { tries: 0, passes: 0, bestPct: 0 };
    next.departments[challengeId] = {
      tries: prevDept.tries + 1,
      passes: prevDept.passes + (record.passed ? 1 : 0),
      bestPct: Math.max(prevDept.bestPct, record.pct),
    };

    if (!isReplay) {
      const existingTries = next.today.day === dayNumber ? next.today.tries : [];
      if (existingTries.length < maxTries && !existingTries.some((t) => t.passed)) {
        next.today = {
          day: dayNumber,
          tries: [...existingTries, record],
          ...(displaySquares && displaySquares.length > 0
            ? { displaySquares: [...displaySquares] }
            : {}),
        };
      }

      if (record.passed && next.lastDay !== dayNumber) {
        next.streak = next.lastDay === dayNumber - 1 ? next.streak + 1 : 1;
        next.lastDay = dayNumber;
      } else if (next.lastDay > 0 && dayNumber - next.lastDay > 1 && !record.passed) {
        next.streak = 0;
      }
    }

    this.save(next);
  }
}
