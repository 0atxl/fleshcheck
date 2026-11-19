import { STAMPS_CALM, STAMPS_PASS, STAMPS_REJECT } from "../copy/global";
import { mulberry32 } from "../game/prng";
import { FONT_LABEL, THEME } from "../game/theme";
import type { ChallengeVariant } from "../game/types";

const BASE_W = 560;
const BASE_H_TWO_LINE = 190;
const BASE_H_ONE_LINE = 150;

export const STAMP_BASE_WIDTH = BASE_W;

/**
 * Picks the day's stamp wording. Stable per seed so the stamp that hangs over
 * the player's face during the round is the same one that lands on the card.
 */
export function pickStampText(seed: number, passed: boolean, variant?: ChallengeVariant): string {
  if (passed && variant === "too-calm") {
    const rng = mulberry32((seed ^ 0x7f4a7c15) >>> 0);
    return STAMPS_CALM[Math.floor(rng() * STAMPS_CALM.length)] ?? STAMPS_CALM[0]!;
  }
  const list = passed ? STAMPS_PASS : STAMPS_REJECT;
  const rng = mulberry32((seed ^ (passed ? 0x9e3779b1 : 0x51ed270b)) >>> 0);
  return list[Math.floor(rng() * list.length)] ?? list[0]!;
}

/**
 * Renders a rubber-stamp impression to an offscreen bitmap: double border,
 * condensed caps, then punched with speckle, scratches and uneven pressure so
 * it reads as ink on paper instead of a vector outline. Deterministic per seed.
 */
export function createStampBitmap(
  text: string,
  color: string,
  seed: number,
): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const [head, reason] = splitStampText(text);
  const height = reason ? BASE_H_TWO_LINE : BASE_H_ONE_LINE;

  const bmp = document.createElement("canvas");
  bmp.width = BASE_W;
  bmp.height = height;
  const ctx = bmp.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect?.(0, 0, BASE_W, height);

  // Double border
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.strokeRect(10, 10, BASE_W - 20, height - 20);
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 24, BASE_W - 48, height - 48);

  // Text, fitted to the inner width
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const innerW = BASE_W - 90;

  const headSize = fitFont(ctx, head, 700, reason ? 78 : 66, innerW);
  ctx.font = `700 ${headSize}px ${FONT_LABEL}`;
  ctx.fillText(head, BASE_W / 2, reason ? height * 0.39 : height / 2 + 2, innerW);

  if (reason) {
    const reasonSize = fitFont(ctx, reason, 700, 34, innerW);
    ctx.font = `700 ${reasonSize}px ${FONT_LABEL}`;
    ctx.fillText(reason, BASE_W / 2, height * 0.7, innerW);
  }

  // Wear: punch speckle, uneven pressure and scratches out of the ink
  const rng = mulberry32(seed >>> 0);
  ctx.globalCompositeOperation = "destination-out";

  for (let i = 0; i < 260; i++) {
    const r = 0.5 + rng() * 2.1;
    ctx.fillStyle = `rgba(0,0,0,${(0.45 + rng() * 0.55).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(rng() * BASE_W, rng() * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(0.2 + rng() * 0.25).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(rng() * BASE_W, rng() * height, 3 + rng() * 8, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = `rgba(0,0,0,${(0.1 + rng() * 0.1).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(rng() * BASE_W, rng() * height, 50 + rng() * 60, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 6; i++) {
    const x = rng() * BASE_W;
    const y = rng() * height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 120, y + (rng() - 0.5) * 30);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";

  return bmp;
}

export interface StampBlit {
  cx: number;
  cy: number;
  /** Display width of the stamp in canvas pixels at scale 1. */
  width: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  blend?: GlobalCompositeOperation;
}

/** Draws a stamp bitmap centred at (cx, cy). */
export function blitStamp(
  ctx: CanvasRenderingContext2D,
  bmp: HTMLCanvasElement,
  opts: StampBlit,
): void {
  const fit = opts.width / BASE_W;
  const w = BASE_W * fit;
  const h = bmp.height * fit;
  ctx.save();
  ctx.translate(opts.cx, opts.cy);
  ctx.rotate(opts.rotation ?? -0.09);
  ctx.scale(opts.scaleX ?? 1, opts.scaleY ?? 1);
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.globalCompositeOperation = opts.blend ?? "source-over";
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function stampColor(passed: boolean): string {
  return passed ? THEME.stampBlue : THEME.stampRed;
}

function splitStampText(text: string): [string, string] {
  const idx = text.indexOf(": ");
  if (idx === -1) return [text, ""];
  return [text.slice(0, idx), text.slice(idx + 2)];
}

function fitFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  weight: number,
  startSize: number,
  maxWidth: number,
): number {
  let size = startSize;
  while (size > 18) {
    ctx.font = `${weight} ${size}px ${FONT_LABEL}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}
