import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";
import { coverRect } from "../src/vision/geometry";
import { FaceTracker } from "../src/vision/tracker";

function makeFakeVideo(): HTMLVideoElement {
  return {
    readyState: 4, // HAVE_ENOUGH_DATA
    videoWidth: 640,
    videoHeight: 480,
  } as unknown as HTMLVideoElement;
}

function makeFakeResult(smile: number, noseX = 0.5): FaceLandmarkerResult {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  landmarks[1] = { x: noseX, y: 0.5, z: 0, visibility: 1 };
  landmarks[33] = { x: 0.4, y: 0.4, z: 0, visibility: 1 };
  landmarks[263] = { x: 0.6, y: 0.4, z: 0, visibility: 1 };
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [
      {
        categories: [
          { index: 0, score: smile, categoryName: "mouthSmileLeft", displayName: "" },
        ],
        headIndex: 0,
        headName: "",
      },
    ],
    facialTransformationMatrixes: [
      {
        rows: 4,
        columns: 4,
        data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ],
  };
}

describe("FaceTracker cadence, timestamp monotonicity, and error recovery", () => {
  it("applies EMA smoothing only on inference ticks so 60Hz and 120Hz produce identical signals", () => {
    const rect = coverRect(640, 480, 640, 480);
    const video = makeFakeVideo();
    let callCount = 0;
    const landmarker = {
      detectForVideo: () => {
        callCount += 1;
        return makeFakeResult(callCount === 1 ? 0.0 : 1.0);
      },
    } as unknown as FaceLandmarker;

    const tracker = new FaceTracker(landmarker);

    // Tick 1 at t=100 (inference #1 => smile = 0.0)
    const f1 = tracker.step(video, 100, 16, rect, null);
    expect(f1.ranInference).toBe(true);
    expect(f1.signal.shapes.mouthSmileLeft).toBeCloseTo(0, 5);

    // Tick 2 at t=150 (inference #2 => raw 1.0 smoothed with EMA 0.45 => 0.45)
    const f2 = tracker.step(video, 150, 16, rect, null);
    expect(f2.ranInference).toBe(true);
    expect(f2.signal.shapes.mouthSmileLeft).toBeCloseTo(0.45, 5);

    // Non-inference frames at 120Hz (t=158, 166, 174) must NOT re-apply EMA
    const f3 = tracker.step(video, 158, 8, rect, null);
    const f4 = tracker.step(video, 166, 8, rect, null);
    const f5 = tracker.step(video, 174, 8, rect, null);
    expect(f3.ranInference).toBe(false);
    expect(f3.signal.shapes.mouthSmileLeft).toBeCloseTo(0.45, 5);
    expect(f4.signal.shapes.mouthSmileLeft).toBeCloseTo(0.45, 5);
    expect(f5.signal.shapes.mouthSmileLeft).toBeCloseTo(0.45, 5);
  });

  it("maintains strictly increasing integer timestamps across retries sharing a FaceLandmarker", () => {
    const rect = coverRect(640, 480, 640, 480);
    const video = makeFakeVideo();
    const seenTimestamps: number[] = [];
    const landmarker = {
      detectForVideo: (_video: HTMLVideoElement, ts: number) => {
        seenTimestamps.push(ts);
        return makeFakeResult(0.1);
      },
    } as unknown as FaceLandmarker;

    const tracker1 = new FaceTracker(landmarker);
    tracker1.step(video, 500.4, 16, rect, null);

    // New FaceTracker created for retry with same or earlier clock value
    const tracker2 = new FaceTracker(landmarker);
    tracker2.step(video, 500.6, 16, rect, null);

    expect(seenTimestamps).toHaveLength(2);
    expect(Number.isInteger(seenTimestamps[0])).toBe(true);
    expect(Number.isInteger(seenTimestamps[1])).toBe(true);
    expect(seenTimestamps[1]!).toBeGreaterThan(seenTimestamps[0]!);
  });

  it("catches detectForVideo exceptions without crashing the frame loop", () => {
    const rect = coverRect(640, 480, 640, 480);
    const video = makeFakeVideo();
    const landmarker = {
      detectForVideo: () => {
        throw new Error("WebGL context lost");
      },
    } as unknown as FaceLandmarker;

    const tracker = new FaceTracker(landmarker);
    const frame = tracker.step(video, 100, 16, rect, null);
    expect(frame.signal.tracked).toBe(false);
  });
});
