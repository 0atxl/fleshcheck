export interface CopyTemplateContext {
  weekday?: string;
  time?: string;
  streak?: number;
  tries?: number;
  lastResult?: string;
  case?: string;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const TOKEN_RE = /\{([a-zA-Z0-9_]+)\}/g;

/** Returns true if a copy line contains one or more `{token}` placeholders. */
export function hasTemplateTokens(line: string): boolean {
  return /\{[a-zA-Z0-9_]+\}/.test(line);
}

/**
 * Pure template renderer for office copy.
 * Supported tokens: {weekday}, {time}, {streak}, {tries}, {lastResult}, {case}.
 * Returns `fallback ?? null` when any referenced token is missing or invalid so
 * raw placeholders are never shown to the player.
 */
export function renderCopy(
  line: string,
  ctx?: CopyTemplateContext,
  fallback?: string,
): string | null {
  if (!hasTemplateTokens(line)) {
    return line;
  }

  let missing = false;
  const rendered = line.replace(TOKEN_RE, (_match, key: string) => {
    const val = resolveToken(key, ctx);
    if (val === null) {
      missing = true;
      return "";
    }
    return val;
  });

  if (missing || rendered.includes("{") || rendered.includes("}")) {
    return fallback !== undefined ? fallback : null;
  }
  return rendered;
}

function resolveToken(key: string, ctx?: CopyTemplateContext): string | null {
  if (!ctx) return null;
  switch (key) {
    case "weekday":
      return sanitizeText(ctx.weekday);
    case "time":
      return sanitizeText(ctx.time);
    case "lastResult":
      return sanitizeText(ctx.lastResult);
    case "case":
      return sanitizeText(ctx.case);
    case "streak":
      return sanitizeNumber(ctx.streak);
    case "tries":
      return sanitizeNumber(ctx.tries);
    default:
      return null;
  }
}

function sanitizeText(val: string | undefined): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (!trimmed || trimmed.includes("{") || trimmed.includes("}")) return null;
  return trimmed;
}

function sanitizeNumber(val: number | undefined): string | null {
  if (typeof val !== "number" || !Number.isFinite(val) || val < 0) return null;
  return String(Math.floor(val));
}

export interface BuildCopyContextInput {
  caseNumber: number;
  now?: Date;
  streak?: number;
  tries?: number;
  lastResult?: string;
}

/**
 * Builds local-only personalization context from the device clock and case file.
 */
export function buildCopyContext(input: BuildCopyContextInput): CopyTemplateContext {
  const now = input.now ?? new Date();
  const weekday = WEEKDAYS[now.getDay()] ?? "Monday";
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const dayStr = String(Math.max(1, Math.floor(input.caseNumber))).padStart(2, "0");

  return {
    weekday,
    time: `${hours}:${minutes}`,
    case: `#${dayStr}`,
    ...(input.streak !== undefined ? { streak: input.streak } : {}),
    ...(input.tries !== undefined ? { tries: input.tries } : {}),
    ...(input.lastResult !== undefined ? { lastResult: input.lastResult } : {}),
  };
}
