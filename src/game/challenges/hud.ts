import { FONT_LABEL, FONT_TYPE, THEME } from "../theme";
import type { Rect2D, Viewport } from "../types";

/**
 * Draws word-wrapped text centered vertically around `cy` within `maxWidth`.
 */
export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
  maxLines?: number,
): void {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return;

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = probe;
    }
  }
  if (current) lines.push(current);

  const visible = maxLines !== undefined && lines.length > maxLines ? lines.slice(0, maxLines) : lines;
  const startY = cy - ((visible.length - 1) * lineHeight) / 2;
  for (let i = 0; i < visible.length; i++) {
    ctx.fillText(visible[i]!, x, startY + i * lineHeight, maxWidth);
  }
}

/**
 * Splits text into lines that fit `maxWidth` using the context's current font.
 * Lines beyond `maxLines` are dropped.
 */
export function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 3,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const probe = current ? `${current} ${word}` : word;
    if (ctx.measureText(probe).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = probe;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

export interface ProgressLineOptions {
  danger?: boolean;
  accent?: string;
}

/**
 * 4px progress hairline along the top edge of the CCTV viewport.
 */
export function drawProgressLine(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  progress: number,
  opts: ProgressLineOptions = {},
): void {
  const clamped = Math.max(0, Math.min(1, progress));
  ctx.fillStyle = "rgba(20, 19, 15, 0.45)";
  ctx.fillRect(0, 0, vp.width, 4);
  ctx.fillStyle = opts.danger ? THEME.stampRed : opts.accent ?? THEME.paper;
  ctx.fillRect(0, 0, vp.width * clamped, 4);
}

export interface TimerTagOptions {
  /** Optional compact counter chip shown immediately left of the countdown (e.g. "2/4"). */
  counter?: string;
}

/**
 * Paper timer tag pinned to the top-right corner, keeping the burned-in CCTV
 * case label on the top-left completely unobstructed.
 */
export function drawTimerTag(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  remainingMs: number,
  opts: TimerTagOptions = {},
): void {
  const compact = vp.width < 520;
  const remaining = Math.max(0, remainingMs / 1000).toFixed(1);
  const timerLabel = `${remaining}s`;

  ctx.font = `700 ${compact ? 17 : 20}px ${FONT_TYPE}`;
  const tagW = ctx.measureText(timerLabel).width + 20;
  const tagH = compact ? 28 : 32;
  const tagX = vp.width - tagW - 12;
  const tagY = 14;

  ctx.fillStyle = THEME.paper;
  ctx.fillRect(tagX, tagY, tagW, tagH);
  ctx.fillStyle = THEME.ink;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(timerLabel, vp.width - 22, tagY + tagH / 2 + 1);

  if (opts.counter) {
    ctx.font = `700 ${compact ? 13 : 15}px ${FONT_LABEL}`;
    const counterW = ctx.measureText(opts.counter).width + 16;
    const counterX = tagX - counterW - 6;
    ctx.fillStyle = THEME.paperDeep;
    ctx.fillRect(counterX, tagY, counterW, tagH);
    ctx.fillStyle = THEME.formBlue;
    ctx.textAlign = "center";
    ctx.fillText(opts.counter, counterX + counterW / 2, tagY + tagH / 2 + 1);
  }
}

export interface PromptStripOptions {
  /** Small condensed form label above the main text (e.g. "NOD YES · SHAKE NO"). */
  label?: string;
  /** Override color for the small label (defaults to THEME.formBlue). */
  labelColor?: string;
  /** Bottom border / rule color (defaults to THEME.ink). */
  borderAccent?: string;
  /** Optional typewriter character reveal count; shows blinking caret when set. */
  revealChars?: number;
  /** Elapsed ms used to blink the typewriter caret when revealChars is set. */
  elapsedMs?: number;
  /** Optional embedded horizontal meter bar at the bottom of the paper strip. */
  meter?: { fraction: number; color?: string };
  maxLines?: number;
}

/**
 * Paper strip anchored to the bottom of the viewport with typed copy,
 * matching the Poker Face taunt strip aesthetic.
 */
export function drawPromptStrip(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  text: string,
  opts: PromptStripOptions = {},
): Rect2D {
  const compact = vp.width < 520;
  const fontSize = compact ? 18 : 21;
  const lineH = Math.round(fontSize * 1.32);
  const margin = 14;
  const padX = 14;
  const padTop = opts.label ? 10 : 14;
  const padBottom = opts.meter ? 20 : 14;
  const labelH = opts.label ? 18 : 0;
  const boxW = vp.width - margin * 2;

  ctx.font = `500 ${fontSize}px ${FONT_TYPE}`;
  const lines = wrapLines(ctx, text, boxW - padX * 2, opts.maxLines ?? 3);
  const textH = Math.max(1, lines.length) * lineH;
  const boxH = padTop + labelH + textH + padBottom - 2;
  const boxY = vp.height - boxH - margin;

  ctx.fillStyle = THEME.paper;
  ctx.fillRect(margin, boxY, boxW, boxH);
  ctx.fillStyle = opts.borderAccent ?? THEME.ink;
  ctx.fillRect(margin, boxY + boxH - 3, boxW, 3);

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  if (opts.label) {
    ctx.font = `700 12px ${FONT_LABEL}`;
    ctx.fillStyle = opts.labelColor ?? THEME.formBlue;
    ctx.fillText(opts.label, margin + padX, boxY + padTop + 7, boxW - padX * 2);
  }

  ctx.font = `500 ${fontSize}px ${FONT_TYPE}`;
  ctx.fillStyle = THEME.ink;
  const textStartY = boxY + padTop + labelH;

  if (opts.revealChars !== undefined) {
    let remaining = Math.max(0, Math.floor(opts.revealChars));
    let caretX = margin + padX;
    let caretY = textStartY + lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const shown = line.slice(0, remaining);
      const y = textStartY + i * lineH + lineH / 2;
      ctx.fillText(shown, margin + padX, y);
      caretX = margin + padX + ctx.measureText(shown).width;
      caretY = y;
      remaining -= line.length + 1;
      if (remaining <= 0) break;
    }
    const blink = Math.floor((opts.elapsedMs ?? 0) / 450) % 2 === 0;
    if (blink) {
      ctx.fillStyle = THEME.ink;
      ctx.fillRect(
        caretX + 2,
        caretY - fontSize * 0.55,
        Math.ceil(fontSize * 0.5),
        Math.ceil(fontSize * 1.1),
      );
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const y = textStartY + i * lineH + lineH / 2;
      ctx.fillText(lines[i]!, margin + padX, y, boxW - padX * 2);
    }
  }

  if (opts.meter) {
    const barX = margin + padX;
    const barW = boxW - padX * 2;
    const barY = boxY + boxH - 13;
    const frac = Math.max(0, Math.min(1, opts.meter.fraction));
    ctx.fillStyle = "rgba(26, 26, 24, 0.18)";
    ctx.fillRect(barX, barY, barW, 5);
    ctx.fillStyle = opts.meter.color ?? THEME.formBlue;
    ctx.fillRect(barX, barY, barW * frac, 5);
  }

  return { x: margin, y: boxY, w: boxW, h: boxH };
}

/**
 * Ensures an evidence bounding box has sensible minimum size and stays within viewport bounds.
 */
export function clampEvidenceRect(
  rect: Rect2D,
  vp: Viewport,
  minW = 56,
  minH = 40,
): Rect2D {
  const cx = rect.w > 0 ? rect.x + rect.w / 2 : vp.width / 2;
  const cy = rect.h > 0 ? rect.y + rect.h / 2 : vp.height / 2;
  const w = Math.min(vp.width - 12, Math.max(minW, rect.w));
  const h = Math.min(vp.height - 12, Math.max(minH, rect.h));
  const x = Math.max(6, Math.min(vp.width - w - 6, cx - w / 2));
  const y = Math.max(6, Math.min(vp.height - h - 6, cy - h / 2));
  return { x, y, w, h };
}
