import type { Point2D, Rect2D } from "../game/types";

export interface CoverRect {
  ox: number;
  oy: number;
  dw: number;
  dh: number;
  srcW: number;
  srcH: number;
  dstW: number;
  dstH: number;
}

/**
 * Face oval landmark indices from MediaPipe's 478-landmark mesh.
 */
export const FACE_OVAL_INDICES = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
] as const;

/**
 * Computes destination drawing coordinates for object-fit: cover rendering.
 */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): CoverRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { ox: 0, oy: 0, dw: dstW, dh: dstH, srcW, srcH, dstW, dstH };
  }
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  const ox = (dstW - dw) / 2;
  const oy = (dstH - dh) / 2;
  return { ox, oy, dw, dh, srcW, srcH, dstW, dstH };
}

/**
 * Maps a normalized [0,1] image landmark into cover-fitted canvas coordinates.
 */
export function toCanvas(
  landmark: Point2D,
  rect: CoverRect,
  mirror = true,
): Point2D {
  const nx = mirror ? 1 - landmark.x : landmark.x;
  return {
    x: rect.ox + nx * rect.dw,
    y: rect.oy + landmark.y * rect.dh,
  };
}

/**
 * Computes an axis-aligned bounding box around the face oval landmarks.
 */
export function computeFaceBox(landmarks: readonly Point2D[]): Rect2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const idx of FACE_OVAL_INDICES) {
    const pt = landmarks[idx];
    if (!pt) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }

  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  return {
    x: minX,
    y: minY,
    w: Math.max(0, maxX - minX),
    h: Math.max(0, maxY - minY),
  };
}
