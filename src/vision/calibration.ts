import type { Baseline, Point2D } from "../game/types";
import { type BlendshapeMap, type BlendshapeName } from "./blendshapes";

export interface CalibrationSample {
  shapes: BlendshapeMap;
  nose: Point2D;
  rollRad: number;
  eyeRollRad?: number;
  yawRad?: number;
  pitchRad?: number;
}

/**
 * Accumulates neutral-face baseline samples over the calibration window so all
 * downstream challenges evaluate relative change instead of fixed thresholds.
 */
export class CalibrationCollector {
  private readonly shapeSums: BlendshapeMap = {};
  private noseSumX = 0;
  private noseSumY = 0;
  private rollSum = 0;
  private eyeRollSum = 0;
  private eyeRollWeight = 0;
  private yawSum = 0;
  private pitchSum = 0;
  private totalWeight = 0;
  private count = 0;
  private elapsedMs = 0;

  constructor(private readonly targetMs: number) {}

  addSample(dtMs: number, sample: CalibrationSample | null): void {
    if (!sample) return;
    const clampedDt = Math.max(0, dtMs);
    const weight = Math.max(1, clampedDt);
    this.elapsedMs += clampedDt;
    this.count += 1;
    this.totalWeight += weight;
    this.noseSumX += sample.nose.x * weight;
    this.noseSumY += sample.nose.y * weight;
    this.rollSum += sample.rollRad * weight;
    if (sample.eyeRollRad !== undefined) {
      this.eyeRollSum += sample.eyeRollRad * weight;
      this.eyeRollWeight += weight;
    }
    this.yawSum += (sample.yawRad ?? 0) * weight;
    this.pitchSum += (sample.pitchRad ?? 0) * weight;

    for (const [key, val] of Object.entries(sample.shapes) as [BlendshapeName, number | undefined][]) {
      if (val === undefined) continue;
      this.shapeSums[key] = (this.shapeSums[key] ?? 0) + val * weight;
    }
  }

  get progress(): number {
    if (this.targetMs <= 0) return 1;
    return Math.min(1, this.elapsedMs / this.targetMs);
  }

  isDone(): boolean {
    return this.elapsedMs >= this.targetMs && this.count > 0;
  }

  finalize(): Baseline {
    const w = Math.max(1, this.totalWeight);
    const shapes: BlendshapeMap = {};
    for (const [key, sum] of Object.entries(this.shapeSums) as [BlendshapeName, number | undefined][]) {
      if (sum === undefined) continue;
      shapes[key] = sum / w;
    }
    return {
      shapes,
      nose: {
        x: this.noseSumX / w,
        y: this.noseSumY / w,
      },
      rollRad: this.rollSum / w,
      ...(this.eyeRollWeight > 0 ? { eyeRollRad: this.eyeRollSum / this.eyeRollWeight } : {}),
      yawRad: this.yawSum / w,
      pitchRad: this.pitchSum / w,
    };
  }
}

/**
 * Computes raw blendshape scores minus calibrated neutral baseline.
 */
export function computeBlendshapeDeltas(
  shapes: BlendshapeMap,
  baselineShapes: BlendshapeMap,
): BlendshapeMap {
  const delta: BlendshapeMap = {};
  for (const [key, value] of Object.entries(shapes) as [BlendshapeName, number | undefined][]) {
    if (value === undefined) continue;
    delta[key] = value - (baselineShapes[key] ?? 0);
  }
  return delta;
}
