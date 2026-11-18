export const LAUNCH_EPOCH_UTC = Date.UTC(2026, 10, 18); // 2026-11-18 UTC = Day #01
export const DEFAULT_DURATION_MS = 12_000;
export const CALIBRATION_MS = 1_500;
export const FACE_LOSS_GRACE_MS = 300;
export const MAX_PAUSES_PER_TRY = 3;
export const MAX_TRIES_PER_DAY = 3;
export const PREFETCH_DWELL_MS = 3_000;
export const STORAGE_KEY = "fleshcheck:v1";

export function getSiteDisplay(): string {
  if (typeof window !== "undefined" && window.location.host) {
    return window.location.host;
  }
  return "fleshcheck";
}
