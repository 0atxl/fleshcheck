import { getSiteDisplay } from "../config";
import { STREAK_RANKS } from "../copy/global";
import type { ChallengeResult, TryRecord } from "./types";

/**
 * Converts challenge progress [0..1] and status into an integer 0..100 human score.
 * Non-passing runs are always capped at 99%.
 */
export function computeHumanPct(progress: number, status: ChallengeResult["status"]): number {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (status === "passed") {
    return 100;
  }
  return Math.min(99, Math.round(clamped * 100));
}

/**
 * Builds a single try's emoji token with optional pause warning suffix.
 */
export function formatTrySquare(record: TryRecord): string {
  const base = record.passed ? "🟩" : "🟥";
  return record.paused ? `${base}⚠️` : base;
}

/**
 * Formats the Wordle-style clipboard / post share text.
 */
export function formatShareLine(options: {
  dayNumber: number;
  caseLabel?: string;
  title: string;
  tries: readonly TryRecord[];
  bestPct: number;
  isReplay?: boolean;
  site?: string;
}): string {
  const dayStr = String(options.dayNumber).padStart(2, "0");
  const replayTag = options.isReplay ? " (replay)" : "";
  const caseToken =
    options.caseLabel !== undefined
      ? options.caseLabel
        ? ` ${options.caseLabel}`
        : ""
      : ` #${dayStr}${replayTag}`;
  const squares = options.tries.map(formatTrySquare).join("");
  const site = options.site ?? getSiteDisplay();
  const titleUpper = options.title.toUpperCase();

  return `FLESHCHECK${caseToken} · ${titleUpper} · ${squares} · ${options.bestPct}% HUMAN\n${site}`;
}

/**
 * Selects the highest-scoring try (preferring passing tries on ties).
 */
export function pickBestTry(tries: readonly TryRecord[]): TryRecord | null {
  let best: TryRecord | null = null;
  for (const t of tries) {
    if (!best) {
      best = t;
      continue;
    }
    if (t.pct > best.pct || (t.pct === best.pct && t.passed && !best.passed)) {
      best = t;
    }
  }
  return best;
}

/**
 * Maps a daily compliance streak to a local bureaucratic rank title.
 */
export function getStreakRank(streak: number): string {
  const safe = Number.isFinite(streak) ? Math.max(0, Math.floor(streak)) : 0;
  for (const tier of STREAK_RANKS) {
    if (safe >= tier.minStreak) {
      return tier.title;
    }
  }
  return "Applicant";
}
