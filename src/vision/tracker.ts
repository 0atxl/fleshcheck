import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { FACE_LOSS_GRACE_MS } from "../config";
import type { Baseline, FaceSignal, HeadPose, Point2D } from "../game/types";
import { computeBlendshapeDeltas } from "./calibration";
import { computeFaceBox, type CoverRect, toCanvas } from "./geometry";
import { headPoseFromMatrix } from "./headpose";

const BASE_INTERVAL_MS = 50; // ~20 Hz
const THROTTLED_INTERVAL_MS = 83; // ~12 Hz when inference runs slowly
const SLOW_INFERENCE_MS = 40;
const EMA_ALPHA = 0.45;

export interface TrackerFrame {
  signal: FaceSignal;
  faceLost: boolean;
  rawShapes: Record<string, number>;
  rawNose: Point2D;
  rawRoll: number;
  rawYaw: number;
  rawPitch: number;
}

/**
 * Wraps MediaPipe FaceLandmarker with adaptive ~20 Hz polling, monotonic
 * timestamps, exponential smoothing, and face-loss grace tracking.
 */
export class FaceTracker {
  private lastInferenceAt = -Infinity;
  private lastVideoTs = 0;
  private intervalMs = BASE_INTERVAL_MS;
  private lostMs = 0;
  private wasTracked = false;

  private smoothedLandmarks: Point2D[] = [];
  private smoothedShapes: Record<string, number> = {};
  private smoothedPose: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
  private lastResult: FaceLandmarkerResult | null = null;

  constructor(private readonly landmarker: FaceLandmarker) {}

  resetLoss(): void {
    this.lostMs = 0;
  }

  /**
   * Advances tracking for the current rendered frame and returns a complete FaceSignal.
   */
  step(
    video: HTMLVideoElement,
    nowMs: number,
    dtMs: number,
    rect: CoverRect,
    baseline: Baseline | null,
    mirror = true,
  ): TrackerFrame {
    if (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      nowMs - this.lastInferenceAt >= this.intervalMs
    ) {
      this.lastInferenceAt = nowMs;
      const monotonicTs = Math.max(this.lastVideoTs + 0.01, nowMs);
      this.lastVideoTs = monotonicTs;

      const t0 = performance.now();
      this.lastResult = this.landmarker.detectForVideo(video, monotonicTs);
      const elapsed = performance.now() - t0;
      this.intervalMs = elapsed > SLOW_INFERENCE_MS ? THROTTLED_INTERVAL_MS : BASE_INTERVAL_MS;
    }

    const rawFace = this.lastResult?.faceLandmarks[0];
    const tracked = Boolean(rawFace && rawFace.length > 0);

    if (!tracked) {
      this.lostMs += Math.max(0, dtMs);
      this.wasTracked = false;
      return {
        signal: {
          t: nowMs,
          tracked: false,
          shapes: this.smoothedShapes,
          delta: baseline ? computeBlendshapeDeltas(this.smoothedShapes, baseline.shapes) : {},
          nose: this.smoothedLandmarks[1] ?? { x: rect.dstW / 2, y: rect.dstH / 2 },
          mouth: { x: rect.dstW / 2, y: rect.dstH / 2 },
          faceBox: { x: 0, y: 0, w: 0, h: 0 },
          pose: this.smoothedPose,
          landmarks: this.smoothedLandmarks,
        },
        faceLost: this.lostMs > FACE_LOSS_GRACE_MS,
        rawShapes: {},
        rawNose: { x: rect.dstW / 2, y: rect.dstH / 2 },
        rawRoll: 0,
        rawYaw: 0,
        rawPitch: 0,
      };
    }

    this.lostMs = 0;
    const rawShapes = extractBlendshapes(this.lastResult);
    const matrixData = this.lastResult?.facialTransformationMatrixes[0]?.data;
    const rawPose = matrixData ? headPoseFromMatrix(matrixData, mirror) : { yaw: 0, pitch: 0, roll: 0 };

    const canvasPoints = rawFace!.map((pt) => toCanvas({ x: pt.x, y: pt.y }, rect, mirror));

    if (!this.wasTracked || this.smoothedLandmarks.length !== canvasPoints.length) {
      this.smoothedLandmarks = canvasPoints;
      this.smoothedShapes = { ...rawShapes };
      this.smoothedPose = { ...rawPose };
    } else {
      this.smoothedLandmarks = canvasPoints.map((pt, idx) => {
        const prev = this.smoothedLandmarks[idx]!;
        return {
          x: prev.x + EMA_ALPHA * (pt.x - prev.x),
          y: prev.y + EMA_ALPHA * (pt.y - prev.y),
        };
      });
      for (const [k, v] of Object.entries(rawShapes)) {
        const prev = this.smoothedShapes[k] ?? v;
        this.smoothedShapes[k] = prev + EMA_ALPHA * (v - prev);
      }
      this.smoothedPose = {
        yaw: this.smoothedPose.yaw + EMA_ALPHA * (rawPose.yaw - this.smoothedPose.yaw),
        pitch: this.smoothedPose.pitch + EMA_ALPHA * (rawPose.pitch - this.smoothedPose.pitch),
        roll: this.smoothedPose.roll + EMA_ALPHA * (rawPose.roll - this.smoothedPose.roll),
      };
    }

    this.wasTracked = true;

    const nose = this.smoothedLandmarks[1] ?? { x: rect.dstW / 2, y: rect.dstH / 2 };
    const upperLip = this.smoothedLandmarks[13] ?? nose;
    const lowerLip = this.smoothedLandmarks[14] ?? nose;
    const mouth = {
      x: (upperLip.x + lowerLip.x) / 2,
      y: (upperLip.y + lowerLip.y) / 2,
    };
    const faceBox = computeFaceBox(this.smoothedLandmarks);
    const delta = baseline
      ? computeBlendshapeDeltas(this.smoothedShapes, baseline.shapes)
      : {};

    return {
      signal: {
        t: nowMs,
        tracked: true,
        shapes: { ...this.smoothedShapes },
        delta,
        nose,
        mouth,
        faceBox,
        pose: { ...this.smoothedPose },
        landmarks: this.smoothedLandmarks,
      },
      faceLost: false,
      rawShapes,
      rawNose: canvasPoints[1] ?? nose,
      rawRoll: rawPose.roll,
      rawYaw: rawPose.yaw,
      rawPitch: rawPose.pitch,
    };
  }
}

function extractBlendshapes(result: FaceLandmarkerResult | null): Record<string, number> {
  const categories = result?.faceBlendshapes[0]?.categories;
  if (!categories) return {};
  const map: Record<string, number> = {};
  for (const cat of categories) {
    map[cat.categoryName] = cat.score;
  }
  return map;
}
