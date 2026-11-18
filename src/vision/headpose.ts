import type { HeadPose } from "../game/types";

/**
 * Decomposes a MediaPipe 4x4 column-major transformation matrix into
 * radians { yaw, pitch, roll } using intrinsic Z-Y-X rotation order.
 */
export function headPoseFromMatrix(data: readonly number[], mirror = true): HeadPose {
  if (data.length < 16) {
    return { yaw: 0, pitch: 0, roll: 0 };
  }

  // Column 0, 1, 2 basis vectors (normalized to remove uniform scale if present)
  const c0x = data[0] ?? 1;
  const c0y = data[1] ?? 0;
  const c0z = data[2] ?? 0;
  const c1x = data[4] ?? 0;
  const c1y = data[5] ?? 1;
  const c1z = data[6] ?? 0;
  const c2x = data[8] ?? 0;
  const c2y = data[9] ?? 0;
  const c2z = data[10] ?? 1;

  const s0 = Math.hypot(c0x, c0y, c0z) || 1;
  const s1 = Math.hypot(c1x, c1y, c1z) || 1;
  const s2 = Math.hypot(c2x, c2y, c2z) || 1;

  const r00 = c0x / s0;
  const r10 = c0y / s0;
  const r20 = c0z / s0;
  const r21 = c1z / s1;
  const r22 = c2z / s2;

  const sy = Math.hypot(r00, r10);
  const singular = sy < 1e-6;

  let pitch: number;
  let yaw: number;
  let roll: number;

  if (!singular) {
    pitch = Math.atan2(r21, r22);
    yaw = Math.atan2(-r20, sy);
    roll = Math.atan2(r10, r00);
  } else {
    const r01 = c1x / s1;
    const r11 = c1y / s1;
    pitch = Math.atan2(-r01, r11);
    yaw = Math.atan2(-r20, sy);
    roll = 0;
  }

  return mirror
    ? { yaw: -yaw, pitch, roll: -roll }
    : { yaw, pitch, roll };
}
