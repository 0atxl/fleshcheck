import { describe, expect, it } from "vitest";
import { computeFaceBox, coverRect, FACE_OVAL_INDICES, toCanvas } from "../src/vision/geometry";

describe("coverRect and mirrored landmark projection", () => {
  it("projects mirrored normalized coordinates accurately on 16:9 landscape canvas", () => {
    const rect = coverRect(1280, 720, 640, 480);
    // 1280x720 scaled to height 480 => scale 480/720 = 2/3, dw = 853.33, ox = -106.67
    expect(rect.dh).toBeCloseTo(480, 3);
    expect(rect.oy).toBeCloseTo(0, 3);

    const center = toCanvas({ x: 0.5, y: 0.5 }, rect, true);
    expect(center.x).toBeCloseTo(320, 3);
    expect(center.y).toBeCloseTo(240, 3);

    const leftRaw = toCanvas({ x: 0.25, y: 0.5 }, rect, true);
    const rightRaw = toCanvas({ x: 0.75, y: 0.5 }, rect, true);
    expect(leftRaw.x).toBeGreaterThan(320);
    expect(rightRaw.x).toBeLessThan(320);
  });

  it("projects mirrored coordinates accurately on 9:16 portrait mobile canvas", () => {
    const rect = coverRect(1280, 720, 480, 640);
    expect(rect.dh).toBeCloseTo(640, 3);
    expect(rect.dw).toBeGreaterThan(480);

    const center = toCanvas({ x: 0.5, y: 0.5 }, rect, true);
    expect(center.x).toBeCloseTo(240, 3);
    expect(center.y).toBeCloseTo(320, 3);
  });

  it("computes bounding box from face-oval landmarks", () => {
    const landmarks = Array.from({ length: 478 }, () => ({ x: 320, y: 240 }));
    landmarks[FACE_OVAL_INDICES[0]!] = { x: 200, y: 100 };
    landmarks[FACE_OVAL_INDICES[1]!] = { x: 440, y: 380 };

    const box = computeFaceBox(landmarks);
    expect(box).toEqual({ x: 200, y: 100, w: 240, h: 280 });
  });
});
