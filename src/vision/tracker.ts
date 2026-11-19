import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { FACE_LOSS_GRACE_MS } from "../config";
import type { Baseline, FaceSignal, HeadPose, Point2D, Rect2D } from "../game/types";
import { type BlendshapeMap, type BlendshapeName, isBlendshapeName } from "./blendshapes";
import { computeBlendshapeDeltas } from "./calibration";
import { computeFaceBox, type CoverRect, toCanvas } from "./geometry";
import { headPoseFromMatrix } from "./headpose";

const BASE_INTERVAL_MS = 50; // ~20 Hz
const THROTTLED_INTERVAL_MS = 83; // ~12 Hz when inference runs slowly
const SLOW_INFERENCE_MS = 40;
const EMA_ALPHA = 0.45;
const HAVE_CURRENT_DATA = 2;

// Track strictly increasing integer ms timestamps per shared FaceLandmarker instance
// so creating a fresh FaceTracker on retry never regresses MediaPipe's graph clock.
const landmarkerLastTs = new WeakMap<FaceLandmarker, number>();

export interface TrackerFrame {
  signal: FaceSignal;
  faceLost: boolean;
  ranInference: boolean;
  rawShapes: BlendshapeMap;
  rawNose: Point2D;
  rawRoll: number;
  rawEyeRoll: number | undefined;
  rawYaw: number;
  rawPitch: number;
}

/**
 * Wraps MediaPipe FaceLandmarker with adaptive ~20 Hz polling, strictly monotonic
 * timestamps, inference-cadence exponential smoothing, and face-loss grace tracking.
 */
export class FaceTracker {
  private lastInferenceAt = -Infinity;
  private intervalMs = BASE_INTERVAL_MS;
  private lostMs = 0;
  private wasTracked = false;

  private smoothedLandmarks: Point2D[] = [];
  private smoothedShapes: BlendshapeMap = {};
  private smoothedPose: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
  private cachedNose: Point2D = { x: 0, y: 0 };
  private cachedMouth: Point2D = { x: 0, y: 0 };
  private cachedFaceBox: Rect2D = { x: 0, y: 0, w: 0, h: 0 };
  private cachedRawShapes: BlendshapeMap = {};
  private cachedRawNose: Point2D = { x: 0, y: 0 };
  private cachedRawPose: HeadPose = { yaw: 0, pitch: 0, roll: 0 };
  private cachedRawEyeRoll: number | undefined;
  private lastRectKey = "";
  private lastResult: FaceLandmarkerResult | null = null;

  constructor(private readonly landmarker: FaceLandmarker) {}

  resetLoss(): void {
    this.lostMs = 0;
  }

  /**
   * Advances tracking for the current rendered frame and returns a complete FaceSignal.
   * Smoothing runs only when a fresh MediaPipe inference result arrives so physics
   * and filtering remain identical across 60 Hz, 120 Hz, and 240 Hz displays.
   */
  step(
    video: HTMLVideoElement,
    nowMs: number,
    dtMs: number,
    rect: CoverRect,
    baseline: Baseline | null,
    mirror = true,
  ): TrackerFrame {
    let ranInference = false;

    if (
      video.readyState >= HAVE_CURRENT_DATA &&
      video.videoWidth > 0 &&
      nowMs - this.lastInferenceAt >= this.intervalMs
    ) {
      this.lastInferenceAt = nowMs;
      const prevTs = landmarkerLastTs.get(this.landmarker) ?? 0;
      const monotonicTs = Math.max(prevTs + 1, Math.floor(nowMs));
      landmarkerLastTs.set(this.landmarker, monotonicTs);

      const t0 = performance.now();
      try {
        this.lastResult = this.landmarker.detectForVideo(video, monotonicTs);
        ranInference = true;
      } catch {
        // Recover cleanly from transient WebGL/video hiccups instead of crashing rAF
        this.lastResult = null;
      }
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
        ranInference,
        rawShapes: {},
        rawNose: { x: rect.dstW / 2, y: rect.dstH / 2 },
        rawRoll: 0,
        rawEyeRoll: undefined,
        rawYaw: 0,
        rawPitch: 0,
      };
    }

    this.lostMs = 0;
    const rectKey = `${rect.ox}:${rect.oy}:${rect.dw}:${rect.dh}:${mirror ? 1 : 0}`;
    const needsRecompute = ranInference || !this.wasTracked || rectKey !== this.lastRectKey;

    if (needsRecompute) {
      this.lastRectKey = rectKey;
      const canvasPoints = rawFace!.map((pt) => toCanvas({ x: pt.x, y: pt.y }, rect, mirror));
      const rawShapes = extractBlendshapes(this.lastResult);
      const matrixData = this.lastResult?.facialTransformationMatrixes[0]?.data;
      const rawPose = matrixData ? headPoseFromMatrix(matrixData, mirror) : { yaw: 0, pitch: 0, roll: 0 };

      if (!this.wasTracked || this.smoothedLandmarks.length !== canvasPoints.length) {
        this.smoothedLandmarks = canvasPoints;
        this.smoothedShapes = { ...rawShapes };
        this.smoothedPose = { ...rawPose };
      } else if (ranInference) {
        for (let idx = 0; idx < canvasPoints.length; idx++) {
          const prev = this.smoothedLandmarks[idx]!;
          const pt = canvasPoints[idx]!;
          prev.x = prev.x + EMA_ALPHA * (pt.x - prev.x);
          prev.y = prev.y + EMA_ALPHA * (pt.y - prev.y);
        }
        for (const [k, v] of Object.entries(rawShapes) as [BlendshapeName, number | undefined][]) {
          if (v === undefined) continue;
          const prev = this.smoothedShapes[k] ?? v;
          this.smoothedShapes[k] = prev + EMA_ALPHA * (v - prev);
        }
        this.smoothedPose = {
          yaw: this.smoothedPose.yaw + EMA_ALPHA * (rawPose.yaw - this.smoothedPose.yaw),
          pitch: this.smoothedPose.pitch + EMA_ALPHA * (rawPose.pitch - this.smoothedPose.pitch),
          roll: this.smoothedPose.roll + EMA_ALPHA * (rawPose.roll - this.smoothedPose.roll),
        };
      } else {
        // Viewport/cover rect changed without a new inference: re-project immediately
        this.smoothedLandmarks = canvasPoints;
      }

      this.wasTracked = true;

      const nose = this.smoothedLandmarks[1] ?? { x: rect.dstW / 2, y: rect.dstH / 2 };
      const upperLip = this.smoothedLandmarks[13] ?? nose;
      const lowerLip = this.smoothedLandmarks[14] ?? nose;
      this.cachedNose = nose;
      this.cachedMouth = {
        x: (upperLip.x + lowerLip.x) / 2,
        y: (upperLip.y + lowerLip.y) / 2,
      };
      this.cachedFaceBox = computeFaceBox(this.smoothedLandmarks);
      this.cachedRawShapes = rawShapes;
      this.cachedRawNose = canvasPoints[1] ?? nose;
      this.cachedRawPose = rawPose;
      this.cachedRawEyeRoll = computeCanvasEyeRoll(canvasPoints);
    }

    const delta = baseline
      ? computeBlendshapeDeltas(this.smoothedShapes, baseline.shapes)
      : {};

    return {
      signal: {
        t: nowMs,
        tracked: true,
        shapes: { ...this.smoothedShapes },
        delta,
        nose: { ...this.cachedNose },
        mouth: { ...this.cachedMouth },
        faceBox: { ...this.cachedFaceBox },
        pose: { ...this.smoothedPose },
        landmarks: this.smoothedLandmarks,
      },
      faceLost: false,
      ranInference,
      rawShapes: this.cachedRawShapes,
      rawNose: this.cachedRawNose,
      rawRoll: this.cachedRawPose.roll,
      rawEyeRoll: this.cachedRawEyeRoll,
      rawYaw: this.cachedRawPose.yaw,
      rawPitch: this.cachedRawPose.pitch,
    };
  }
}

function computeCanvasEyeRoll(landmarks: readonly Point2D[]): number | undefined {
  const rightOnScreen = landmarks[33];
  const leftOnScreen = landmarks[263];
  if (!rightOnScreen || !leftOnScreen) return undefined;
  const dx = rightOnScreen.x - leftOnScreen.x;
  const dy = rightOnScreen.y - leftOnScreen.y;
  if (Math.hypot(dx, dy) <= 5) return undefined;
  return Math.atan2(dy, dx);
}

function extractBlendshapes(result: FaceLandmarkerResult | null): BlendshapeMap {
  const categories = result?.faceBlendshapes[0]?.categories;
  if (!categories) return {};
  const map: BlendshapeMap = {};
  for (const cat of categories) {
    if (isBlendshapeName(cat.categoryName)) {
      map[cat.categoryName] = cat.score;
    }
  }
  return map;
}
