import { getSiteDisplay } from "../config";
import { STAMPS_PASS, STAMPS_REJECT } from "../copy/global";
import { mulberry32 } from "../game/prng";
import { formatTrySquare } from "../game/scoring";
import type { TryRecord } from "../game/types";
import { coverRect } from "../vision/geometry";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 675;

export interface EvidenceCardInput {
  dayNumber: number;
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
}

/**
 * Renders the 1200x675 compliance evidence card onto a Canvas 2D surface.
 */
export function renderEvidenceCard(
  targetCanvas: HTMLCanvasElement,
  input: EvidenceCardInput,
): void {
  targetCanvas.width = CARD_WIDTH;
  targetCanvas.height = CARD_HEIGHT;
  const ctx = targetCanvas.getContext("2d");
  if (!ctx) return;

  // Base archival off-white card
  ctx.fillStyle = "#F6F7F4";
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Left half: frozen frame (0..600)
  const leftW = 600;
  ctx.fillStyle = "#1A1D1E";
  ctx.fillRect(0, 0, leftW, CARD_HEIGHT);

  if (input.snapshot && input.snapshot.width > 0 && input.snapshot.height > 0) {
    const rect = coverRect(input.snapshot.width, input.snapshot.height, leftW, CARD_HEIGHT);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, leftW, CARD_HEIGHT);
    ctx.clip();
    ctx.drawImage(input.snapshot, rect.ox, rect.oy, rect.dw, rect.dh);
    ctx.restore();
  } else {
    ctx.fillStyle = "#8C9194";
    ctx.font = "600 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FRAME ARCHIVE NOT RETAINED", leftW / 2, CARD_HEIGHT / 2);
  }

  // Telemetry footer strip over left frame
  ctx.fillStyle = "rgba(26, 29, 30, 0.88)";
  ctx.fillRect(0, CARD_HEIGHT - 84, leftW, 84);

  ctx.fillStyle = input.passed ? "#51CF66" : "#FF6B6B";
  ctx.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(input.callout.toUpperCase(), 24, CARD_HEIGHT - 54);

  const secSurvived = (input.elapsedMs / 1000).toFixed(1);
  const secTarget = (input.durationMs / 1000).toFixed(1);
  ctx.fillStyle = "#D4D8DA";
  ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`DURATION: ${secSurvived}s / ${secTarget}s · FROZEN EVIDENCE FRAME`, 24, CARD_HEIGHT - 26);

  // Vertical divider
  ctx.fillStyle = "#1A1D1E";
  ctx.fillRect(leftW, 0, 2, CARD_HEIGHT);

  // Right half: Compliance dossier (600..1200)
  const rx = 640;
  const rw = 520;

  ctx.fillStyle = "#5C6266";
  ctx.font = "700 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.fillText("OFFICE OF BIOLOGICAL VERIFICATION", rx, 54);

  ctx.fillStyle = "#1A1D1E";
  ctx.font = "700 22px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("BIOMETRIC COMPLIANCE RECORD", rx, 86);

  ctx.strokeStyle = "#C7CCC9";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rx, 112);
  ctx.lineTo(rx + rw, 112);
  ctx.stroke();

  const dayStr = String(input.dayNumber).padStart(2, "0");
  const replayNote = input.isReplay ? " · REPLAY" : "";
  ctx.fillStyle = "#5C6266";
  ctx.font = "600 14px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(`DEPARTMENT: ${input.department.toUpperCase()}`, rx, 146);
  ctx.fillText(`CASE #${dayStr}${replayNote} · ${input.title.toUpperCase()}`, rx, 174);

  // Big % HUMAN readout
  ctx.fillStyle = input.passed ? "#2B8A3E" : "#1A1D1E";
  ctx.font = "800 96px system-ui, -apple-system, sans-serif";
  ctx.fillText(`${input.pct}%`, rx, 290);

  ctx.fillStyle = "#1A1D1E";
  ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(input.passed ? "HUMAN · PROBATIONARY" : "HUMAN", rx, 344);

  // Try squares
  const squares = input.tries.map(formatTrySquare).join(" ");
  ctx.font = "28px system-ui, -apple-system, sans-serif";
  ctx.fillText(squares || "—", rx, 408);

  // Angled rubber-ink stamp
  const rng = mulberry32(input.seed + input.pct);
  const stampList = input.passed ? STAMPS_PASS : STAMPS_REJECT;
  const stampText = stampList[Math.floor(rng() * stampList.length)]!;
  drawStamp(ctx, stampText, rx + 260, 505, input.passed ? "#2B8A3E" : "#C92A2A");

  // Footer
  ctx.strokeStyle = "#C7CCC9";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rx, CARD_HEIGHT - 64);
  ctx.lineTo(rx + rw, CARD_HEIGHT - 64);
  ctx.stroke();

  ctx.fillStyle = "#5C6266";
  ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("100% ON-DEVICE · ZERO UPLOAD", rx, CARD_HEIGHT - 36);
  ctx.textAlign = "right";
  ctx.fillText(getSiteDisplay().toUpperCase(), rx + rw, CARD_HEIGHT - 36);
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.09);

  ctx.font = "800 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  const textW = ctx.measureText(text).width;
  const padX = 20;
  const boxW = Math.min(480, textW + padX * 2);
  const boxH = 52;

  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.strokeRect(-boxW / 2, -boxH / 2, boxW, boxH);

  ctx.lineWidth = 1.5;
  ctx.strokeRect(-boxW / 2 + 5, -boxH / 2 + 5, boxW - 10, boxH - 10);

  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 1);

  ctx.restore();
}
