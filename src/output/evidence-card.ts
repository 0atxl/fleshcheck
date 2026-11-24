import { getSiteDisplay } from "../config";
import { mulberry32 } from "../game/prng";
import { formatTrySquare } from "../game/scoring";
import { FONT_LABEL, FONT_TYPE, THEME } from "../game/theme";
import type { TryRecord } from "../game/types";
import { coverRect } from "../vision/geometry";
import { blitStamp, createStampBitmap, pickStampText, stampColor } from "./stamp";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;

export interface EvidenceCardInput {
  dayNumber: number;
  caseLabel?: string;
  title: string;
  department: string;
  pct: number;
  passed: boolean;
  callout: string;
  tries: readonly TryRecord[];
  elapsedMs: number;
  durationMs: number;
  seed: number;
  isReplay: boolean;
  snapshot: HTMLCanvasElement | null;
  stampText?: string;
  rankTitle?: string;
}

const RX = 632;
const RW = 520;

/**
 * Renders the 1200x675 compliance record: a photograph clipped to a form,
 * filled-in fields, and a rubber stamp straddling both.
 */
export function renderEvidenceCard(
  targetCanvas: HTMLCanvasElement,
  input: EvidenceCardInput,
): void {
  targetCanvas.width = CARD_WIDTH;
  targetCanvas.height = CARD_HEIGHT;
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return;

  drawPaper(ctx, input.seed);
  drawPhoto(ctx, input);
  drawForm(ctx, input);

  // Stamp straddling the photo and the form
  const stamp = createStampBitmap(
    input.stampText ?? pickStampText(input.seed, input.passed),
    stampColor(input.passed),
    input.seed + 7,
  );
  if (stamp) {
    blitStamp(ctx, stamp, {
      cx: 612,
      cy: 572,
      width: 430,
      rotation: -0.1,
      alpha: 0.93,
      blend: "multiply",
    });
  }
}

function drawPaper(ctx: CanvasRenderingContext2D, seed: number): void {
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Paper grain
  const rng = mulberry32(seed ^ 0xa5a5a5);
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = rng() > 0.5 ? "rgba(91, 87, 75, 0.05)" : "rgba(255, 255, 255, 0.09)";
    ctx.fillRect(rng() * CARD_WIDTH, rng() * CARD_HEIGHT, 1 + rng() * 2, 1 + rng() * 2);
  }

  // Fold crease
  ctx.fillStyle = "rgba(91, 87, 75, 0.18)";
  ctx.fillRect(0, 337, CARD_WIDTH, 1.5);
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(0, 339, CARD_WIDTH, 1.5);

  // Edge darkening
  if (typeof ctx.createRadialGradient === "function") {
    const g = ctx.createRadialGradient(
      CARD_WIDTH / 2,
      CARD_HEIGHT / 2,
      CARD_HEIGHT * 0.45,
      CARD_WIDTH / 2,
      CARD_HEIGHT / 2,
      CARD_WIDTH * 0.68,
    );
    g.addColorStop(0, "rgba(91, 87, 75, 0)");
    g.addColorStop(1, "rgba(91, 87, 75, 0.2)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  }
}

function drawPhoto(ctx: CanvasRenderingContext2D, input: EvidenceCardInput): void {
  const fx = 50;
  const fy = 52;
  const fw = 518;
  const fh = 570;
  const pad = 16;
  const px = fx + pad;
  const py = fy + pad;
  const pw = fw - pad * 2;
  const ph = 468;

  ctx.save();
  ctx.translate(fx + fw / 2, fy + fh / 2);
  ctx.rotate(-0.022);
  ctx.translate(-(fx + fw / 2), -(fy + fh / 2));

  // Drop shadow and mount
  ctx.fillStyle = "rgba(26, 26, 24, 0.22)";
  ctx.fillRect(fx + 7, fy + 9, fw, fh);
  ctx.fillStyle = THEME.paperLight;
  ctx.fillRect(fx, fy, fw, fh);

  // Photograph
  ctx.fillStyle = THEME.screen;
  ctx.fillRect(px, py, pw, ph);
  const snap = input.snapshot;
  if (snap && snap.width > 0 && snap.height > 0) {
    const rect = coverRect(snap.width, snap.height, pw, ph);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    ctx.drawImage(snap, px + rect.ox, py + rect.oy, rect.dw, rect.dh);
    ctx.restore();
  } else {
    ctx.fillStyle = THEME.inkMuted;
    ctx.font = `700 20px ${FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FRAME ARCHIVE NOT RETAINED", px + pw / 2, py + ph / 2);
  }

  // Caption on the mount
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = THEME.formBlue;
  ctx.font = `700 14px ${FONT_LABEL}`;
  ctx.fillText("EXHIBIT A  ·  FROZEN EVIDENCE FRAME", px, py + ph + 24);
  ctx.fillStyle = THEME.ink;
  ctx.font = `400 16px ${FONT_TYPE}`;
  const secSurvived = (input.elapsedMs / 1000).toFixed(1);
  const secTarget = (input.durationMs / 1000).toFixed(1);
  ctx.fillText(`Elapsed ${secSurvived}s of ${secTarget}s`, px, py + ph + 48);

  // Paper clip tab
  ctx.fillStyle = "rgba(91, 87, 75, 0.55)";
  ctx.fillRect(fx + fw - 120, fy - 10, 14, 54);
  ctx.restore();
}

function drawForm(ctx: CanvasRenderingContext2D, input: EvidenceCardInput): void {
  // Header
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = THEME.formBlue;
  ctx.font = `700 16px ${FONT_LABEL}`;
  ctx.fillText("OFFICE OF BIOLOGICAL VERIFICATION", RX, 66, 968 - RX - 12);

  const titleText = "BIOMETRIC COMPLIANCE RECORD";
  const titleSize = fitLabelFont(ctx, titleText, 36, 20, RW);
  ctx.fillStyle = THEME.ink;
  ctx.font = `700 ${titleSize}px ${FONT_LABEL}`;
  ctx.fillText(titleText, RX, 106, RW);

  ctx.fillStyle = THEME.formBlue;
  ctx.fillRect(RX, 120, RW, 2);

  drawBarcode(ctx, input.seed, 968, 34, 184, 30);

  // Fields
  const dayStr = String(input.dayNumber).padStart(2, "0");
  const caseValue = input.caseLabel ?? `#${dayStr}${input.isReplay ? " replay" : ""}`;
  drawField(ctx, RX, 138, 150, 58, "CASE NO.", caseValue);
  drawField(ctx, RX + 158, 138, RW - 158, 58, "DEPARTMENT", input.department);
  drawField(ctx, RX, 204, RW, 58, "TEST ADMINISTERED", input.title);
  drawField(ctx, RX, 270, RW, 58, "FINDING", input.callout, input.passed ? THEME.stampBlue : THEME.stampRed);

  // Score readout (scales proportionally if fallback fonts measure wider than Archivo Narrow)
  const pctColor = input.passed ? THEME.stampBlue : THEME.ink;
  const pctText = `${input.pct}%`;
  const scoreGap = 12;
  let pctSize = 138;
  let humanSize = 46;
  let probSize = 20;

  ctx.font = `700 ${pctSize}px ${FONT_LABEL}`;
  let pctW = measureWidth(ctx, pctText);
  ctx.font = `700 ${humanSize}px ${FONT_LABEL}`;
  const rawHumanW = measureWidth(ctx, "HUMAN");
  let rawProbW = 0;
  if (input.passed) {
    ctx.font = `700 ${probSize}px ${FONT_LABEL}`;
    rawProbW = measureWidth(ctx, "PROBATIONARY") + 2;
  }
  const totalScoreW = pctW + scoreGap + Math.max(rawHumanW, rawProbW);
  if (totalScoreW > RW) {
    const scale = RW / totalScoreW;
    pctSize = Math.max(64, Math.floor(pctSize * scale));
    humanSize = Math.max(24, Math.floor(humanSize * scale));
    probSize = Math.max(13, Math.floor(probSize * scale));
    ctx.font = `700 ${pctSize}px ${FONT_LABEL}`;
    pctW = measureWidth(ctx, pctText);
  }

  const labelMaxW = Math.max(80, RW - pctW - scoreGap);
  ctx.fillStyle = pctColor;
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${pctSize}px ${FONT_LABEL}`;
  ctx.fillText(pctText, RX - 4, 452, RW - 80);

  ctx.fillStyle = THEME.ink;
  ctx.font = `700 ${humanSize}px ${FONT_LABEL}`;
  ctx.fillText("HUMAN", RX + pctW + scoreGap, 452, labelMaxW);
  if (input.passed) {
    ctx.fillStyle = THEME.stampBlue;
    ctx.font = `700 ${probSize}px ${FONT_LABEL}`;
    ctx.fillText("PROBATIONARY", RX + pctW + scoreGap + 2, 452 - Math.round(humanSize * 1.08), labelMaxW);
  }

  // Attempts & Classification rank
  ctx.fillStyle = THEME.formBlue;
  ctx.font = `700 13px ${FONT_LABEL}`;
  ctx.fillText("ATTEMPTS", RX, 486);
  ctx.fillStyle = THEME.ink;
  ctx.font = "26px system-ui, -apple-system, sans-serif";
  ctx.fillText(input.tries.map(formatTrySquare).join(" ") || "-", RX, 518, 240);

  if (input.rankTitle) {
    const rankX = RX + 250;
    const rankMaxW = RW - 250;
    ctx.fillStyle = THEME.formBlue;
    ctx.font = `700 13px ${FONT_LABEL}`;
    ctx.fillText("CLASSIFICATION", rankX, 486);
    ctx.fillStyle = THEME.ink;
    ctx.font = `700 19px ${FONT_TYPE}`;
    ctx.fillText(input.rankTitle, rankX, 514, rankMaxW);
  }

  // Fine print
  ctx.fillStyle = THEME.inkMuted;
  ctx.font = `400 13px ${FONT_TYPE}`;
  ctx.textAlign = "left";
  ctx.fillText("Processed on this device. No frames were uploaded.", RX, 656, RW - 140);
  ctx.textAlign = "right";
  ctx.fillText(getSiteDisplay(), RX + RW, 656, 170);
}

function measureWidth(ctx: CanvasRenderingContext2D, text: string): number {
  if (typeof ctx.measureText !== "function") return 0;
  const w = ctx.measureText(text)?.width;
  return typeof w === "number" && Number.isFinite(w) ? w : 0;
}

function fitLabelFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  startSize: number,
  minSize: number,
  maxWidth: number,
): number {
  if (typeof ctx.measureText !== "function") return startSize;
  let size = startSize;
  while (size > minSize) {
    ctx.font = `700 ${size}px ${FONT_LABEL}`;
    if (measureWidth(ctx, text) <= maxWidth) break;
    size -= 1;
  }
  return size;
}

function drawField(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
  valueColor: string = THEME.ink,
): void {
  ctx.strokeStyle = THEME.formBlue;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = THEME.formBlue;
  ctx.font = `700 12px ${FONT_LABEL}`;
  ctx.fillText(label, x + 8, y + 16);

  ctx.fillStyle = valueColor;
  ctx.font = `700 21px ${FONT_TYPE}`;
  ctx.fillText(value, x + 8, y + 44, w - 16);
}

/** Decorative barcode, deterministic per seed. */
function drawBarcode(
  ctx: CanvasRenderingContext2D,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const rng = mulberry32(seed ^ 0x2c1b3c6d);
  ctx.fillStyle = THEME.ink;
  let cursor = x;
  while (cursor < x + w) {
    const bar = 1 + Math.floor(rng() * 4);
    const gap = 1 + Math.floor(rng() * 3);
    if (cursor + bar > x + w) break;
    ctx.fillRect(cursor, y, bar, h);
    cursor += bar + gap;
  }
}
