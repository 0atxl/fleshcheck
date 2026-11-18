import { describe, expect, it } from "vitest";
import { headPoseFromMatrix } from "../src/vision/headpose";

function rotationMatrixColMajor(pitch: number, yaw: number, roll: number): number[] {
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cz = Math.cos(roll);
  const sz = Math.sin(roll);

  // R = Rz(roll) * Ry(yaw) * Rx(pitch)
  const r00 = cz * cy;
  const r10 = sz * cy;
  const r20 = -sy;

  const r01 = cz * sy * sx - sz * cx;
  const r11 = sz * sy * sx + cz * cx;
  const r21 = cy * sx;

  const r02 = cz * sy * cx + sz * sx;
  const r12 = sz * sy * cx - cz * sx;
  const r22 = cy * cx;

  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    0, 0, 0, 1,
  ];
}

describe("headpose matrix decomposition", () => {
  it("returns zero angles for identity matrix", () => {
    const id = rotationMatrixColMajor(0, 0, 0);
    const pose = headPoseFromMatrix(id, false);
    expect(pose.pitch).toBeCloseTo(0, 5);
    expect(pose.yaw).toBeCloseTo(0, 5);
    expect(pose.roll).toBeCloseTo(0, 5);
  });

  it("decomposes combined yaw, pitch, and roll accurately", () => {
    const pitch = 0.25;
    const yaw = -0.35;
    const roll = 0.18;
    const mat = rotationMatrixColMajor(pitch, yaw, roll);

    const raw = headPoseFromMatrix(mat, false);
    expect(raw.pitch).toBeCloseTo(pitch, 5);
    expect(raw.yaw).toBeCloseTo(yaw, 5);
    expect(raw.roll).toBeCloseTo(roll, 5);

    const mirrored = headPoseFromMatrix(mat, true);
    expect(mirrored.pitch).toBeCloseTo(pitch, 5);
    expect(mirrored.yaw).toBeCloseTo(-yaw, 5);
    expect(mirrored.roll).toBeCloseTo(-roll, 5);
  });
});
