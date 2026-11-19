import { LAUNCH_EPOCH_UTC } from "../config";
import { mulberry32 } from "./prng";
import type { ChallengeId, ChallengeManifest } from "./types";

const MS_PER_DAY = 86_400_000;

export interface ParsedChallengeLink {
  dayOverride: number | null;
  vsPct: number | null;
}

/**
 * Computes the 1-based UTC day number since launch epoch.
 */
export function getUtcDayNumber(nowMs = Date.now(), epochMs = LAUNCH_EPOCH_UTC): number {
  const nowUtcMidnight = toUtcMidnightMs(nowMs);
  const epochUtcMidnight = toUtcMidnightMs(epochMs);
  const diffDays = Math.floor((nowUtcMidnight - epochUtcMidnight) / MS_PER_DAY);
  return Math.max(1, diffDays + 1);
}

function toUtcMidnightMs(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Returns milliseconds remaining until the next 00:00:00 UTC rollover (1..86_400_000).
 */
export function getMsUntilNextUtcDay(nowMs = Date.now()): number {
  const nextMidnight = toUtcMidnightMs(nowMs) + MS_PER_DAY;
  return Math.max(0, nextMidnight - nowMs);
}

interface DurationFormatLike {
  format(duration: { hours: number; minutes: number; seconds: number }): string;
}

type IntlWithDurationFormat = typeof Intl & {
  DurationFormat?: new (
    locales?: string,
    options?: { style?: string; hoursDisplay?: string },
  ) => DurationFormatLike;
};

let digitalFormatter: DurationFormatLike | null | undefined;

function getDigitalDurationFormatter(): DurationFormatLike | null {
  if (digitalFormatter !== undefined) return digitalFormatter;
  const Ctor =
    typeof Intl !== "undefined" ? (Intl as IntlWithDurationFormat).DurationFormat : undefined;
  if (!Ctor) {
    digitalFormatter = null;
    return null;
  }
  try {
    digitalFormatter = new Ctor("en-US", { style: "digital", hoursDisplay: "always" });
  } catch {
    digitalFormatter = null;
  }
  return digitalFormatter;
}

/**
 * Formats remaining milliseconds as a zero-padded HH:MM:SS digital countdown,
 * using Intl.DurationFormat when available.
 */
export function formatUtcCountdown(remainingMs: number): string {
  const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const fmt = getDigitalDurationFormatter();
  if (fmt) {
    const formatted = fmt.format({ hours, minutes, seconds });
    // Ensure two-digit leading hours (e.g. "04:12:09") for tabular alignment
    return formatted.replace(/^(\d):/, "0$1:");
  }

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Deterministically picks the challenge for `dayNumber` from `active`,
 * re-rolling once whenever a pick would repeat the previous day's challenge.
 */
export function selectDailyChallenge(
  dayNumber: number,
  active: readonly ChallengeManifest[],
): { challenge: ChallengeManifest; seed: number } {
  if (active.length === 0) {
    throw new Error("No active challenges registered");
  }

  const targetDay = Math.max(1, Math.floor(dayNumber));
  let prevId: ChallengeId | null = null;
  let picked = active[0]!;
  let daySeed = targetDay;

  for (let d = 1; d <= targetDay; d++) {
    const seed = (d * 2654435761) >>> 0;
    const rng = mulberry32(seed);
    let idx = Math.floor(rng() * active.length);
    let candidate = active[idx]!;

    if (active.length > 1 && candidate.id === prevId) {
      idx = Math.floor(rng() * active.length);
      candidate = active[idx]!;
      if (candidate.id === prevId) {
        candidate = active[(idx + 1) % active.length]!;
      }
    }

    prevId = candidate.id;
    picked = candidate;
    daySeed = seed;
  }

  return { challenge: picked, seed: daySeed };
}

/**
 * Parses and validates friend-challenge query parameters (?day=<n>&vs=<pct>).
 * Rejects out-of-range, decimal, or non-numeric values.
 */
export function parseChallengeLink(search: string, todayDay: number): ParsedChallengeLink {
  const params = new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
  const rawDay = params.get("day");
  const rawVs = params.get("vs");

  let dayOverride: number | null = null;
  if (rawDay !== null && /^\d+$/.test(rawDay)) {
    const parsed = Number(rawDay);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= todayDay) {
      dayOverride = parsed;
    }
  }

  let vsPct: number | null = null;
  if (rawVs !== null && /^\d+$/.test(rawVs)) {
    const parsed = Number(rawVs);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 100) {
      vsPct = parsed;
    }
  }

  return { dayOverride, vsPct };
}
