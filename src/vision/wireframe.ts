import type { Point2D } from "../game/types";
import { FACE_OVAL_INDICES } from "./geometry";

const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185] as const;

/**
 * Draws a minimal biometric wireframe over the detected face in canvas space.
 */
export function drawFaceWireframe(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Point2D[],
  color = "rgba(232, 226, 208, 0.78)",
): void {
  if (landmarks.length === 0) return;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;

  drawLoop(ctx, landmarks, FACE_OVAL_INDICES);
  drawLoop(ctx, landmarks, LEFT_EYE);
  drawLoop(ctx, landmarks, RIGHT_EYE);
  drawLoop(ctx, landmarks, LIPS_OUTER);

  const nose = landmarks[1];
  if (nose) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(nose.x, nose.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLoop(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly Point2D[],
  indices: readonly number[],
): void {
  let started = false;
  ctx.beginPath();
  for (const idx of indices) {
    const pt = landmarks[idx];
    if (!pt) continue;
    if (!started) {
      ctx.moveTo(pt.x, pt.y);
      started = true;
    } else {
      ctx.lineTo(pt.x, pt.y);
    }
  }
  if (started) {
    ctx.closePath();
    ctx.stroke();
  }
}
