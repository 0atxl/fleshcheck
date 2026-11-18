import { MAX_TRIES_PER_DAY, STORAGE_KEY } from "../config";
import { pickBestTry } from "./scoring";
import type { ChallengeId, TryRecord } from "./types";

export interface DepartmentStats {
  tries: number;
  passes: number;
  bestPct: number;
}

export interface CaseFileData {
  streak: number;
  lastDay: number;
  today: {
    day: number;
    tries: TryRecord[];
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
      return {
        streak: typeof parsed.streak === "number" && parsed.streak >= 0 ? parsed.streak : 0,
        lastDay: typeof parsed.lastDay === "number" && parsed.lastDay >= 0 ? parsed.lastDay : 0,
        today: {
          day: typeof parsed.today?.day === "number" ? parsed.today.day : 0,
          tries: Array.isArray(parsed.today?.tries) ? parsed.today.tries.slice(0, MAX_TRIES_PER_DAY) : [],
        },
        departments: parsed.departments && typeof parsed.departments === "object"
          ? { ...parsed.departments }
          : {},
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

  getTodayTries(dayNumber: number): TryRecord[] {
    if (this.memoryState.today.day !== dayNumber) {
      return [];
    }
    return [...this.memoryState.today.tries];
  }

  isTodayFinished(dayNumber: number): boolean {
    const tries = this.getTodayTries(dayNumber);
    if (tries.length === 0) return false;
    return tries.some((t) => t.passed) || tries.length >= MAX_TRIES_PER_DAY;
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

  /**
   * Records a try at verdict time.
   * Replay runs (?day=) never mutate today's 3-try budget or daily streak.
   */
  recordVerdict(
    challengeId: ChallengeId,
    dayNumber: number,
    record: TryRecord,
    isReplay: boolean,
  ): void {
    const next: CaseFileData = {
      streak: this.memoryState.streak,
      lastDay: this.memoryState.lastDay,
      today: {
        day: this.memoryState.today.day,
        tries: [...this.memoryState.today.tries],
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
      if (existingTries.length < MAX_TRIES_PER_DAY && !existingTries.some((t) => t.passed)) {
        next.today = {
          day: dayNumber,
          tries: [...existingTries, record],
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
