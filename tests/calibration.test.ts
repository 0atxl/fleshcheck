import { describe, expect, it } from "vitest";
import { POKER_FACE_COPY } from "../src/copy/poker-face";
import { PokerFaceChallenge } from "../src/game/challenges/poker-face";
import type { FaceSignal } from "../src/game/types";
import { CalibrationCollector, computeBlendshapeDeltas } from "../src/vision/calibration";

function makeSignal(
  shapes: Record<string, number>,
  baselineShapes: Record<string, number>,
): FaceSignal {
  return {
    t: 1000,
    tracked: true,
    shapes,
    delta: computeBlendshapeDeltas(shapes, baselineShapes),
    nose: { x: 320, y: 240 },
    mouth: { x: 320, y: 300 },
    faceBox: { x: 220, y: 120, w: 200, h: 240 },
    pose: { yaw: 0, pitch: 0, roll: 0 },
    landmarks: [],
  };
}

describe("calibration and relative thresholds", () => {
  it("does not fail POKER_FACE for a naturally smiley resting face", () => {
    const collector = new CalibrationCollector(1500);
    // Simulate a player whose resting smile blendshape is already 0.48
    for (let i = 0; i < 15; i++) {
      collector.addSample(100, {
        shapes: { mouthSmileLeft: 0.48, mouthSmileRight: 0.46, jawOpen: 0.05 },
        nose: { x: 320, y: 240 },
        rollRad: 0,
      });
    }
    // Untracked frames should be ignored
    collector.addSample(500, null);

    expect(collector.isDone()).toBe(true);
    const baseline = collector.finalize();

    const challenge = new PokerFaceChallenge();
    challenge.init({
      seed: 42,
      baseline,
      copy: POKER_FACE_COPY,
      viewport: { width: 640, height: 480 },
      durationMs: 12_000,
    });

    // Holding their resting smile + blinking does NOT fail
    for (let t = 0; t < 2000; t += 50) {
      challenge.update(
        50,
        makeSignal(
          {
            mouthSmileLeft: 0.49,
            mouthSmileRight: 0.47,
            jawOpen: 0.06,
            eyeBlinkLeft: t % 500 === 0 ? 0.9 : 0.05,
            eyeBlinkRight: t % 500 === 0 ? 0.9 : 0.05,
          },
          baseline.shapes,
        ),
      );
      expect(challenge.getResult().status).toBe("running");
    }

    // Smiling significantly above resting baseline for >250ms DOES fail
    for (let t = 0; t < 400; t += 50) {
      challenge.update(
        50,
        makeSignal(
          { mouthSmileLeft: 0.78, mouthSmileRight: 0.75, jawOpen: 0.06 },
          baseline.shapes,
        ),
      );
    }
    expect(challenge.getResult().status).toBe("failed");
  });
});
