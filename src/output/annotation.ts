import type { EvidenceMark } from "../game/types";
import { FONT_LABEL, THEME } from "../game/theme";

/**
 * Circles the feature that betrayed the player: corner brackets around the
 * offending region plus a small instrument tag with the reading.
 */
export function drawEvidenceAnnotation(ctx: CanvasRenderingContext2D, mark: EvidenceMark): void {
  const { x, y, w, h } = mark.rect;
  const arm = Math.max(10, Math.min(w, h) * 0.32);

  ctx.save();
  ctx.strokeStyle = THEME.stampRed;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.strokeRect(x, y, w, h);
  ctx.globalAlpha = 1;

  ctx.lineWidth = 4;
  ctx.lineCap = "square";
  const corners: Array<[number, number, number, number]> = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
    ctx.stroke();
  }

  ctx.font = `700 15px ${FONT_LABEL}`;
  const padX = 8;
  const tagW = ctx.measureText(mark.label).width + padX * 2;
  const tagH = 24;
  const tagX = Math.max(6, Math.min(x, ctx.canvas ? ctx.canvas.width - tagW - 6 : x));
  const above = y - tagH - 4;
  const tagY = above >= 4 ? above : y + h + 4;
  ctx.fillStyle = THEME.stampRed;
  ctx.fillRect(tagX, tagY, tagW, tagH);
  ctx.fillStyle = THEME.paperLight;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(mark.label, tagX + padX, tagY + tagH / 2 + 1);
  ctx.restore();
}
