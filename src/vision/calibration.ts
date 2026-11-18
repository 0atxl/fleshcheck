import type { Baseline, Point2D } from "../game/types";

export interface CalibrationSample {
  shapes: Record<string, number>;
  nose: Point2D;
  rollRad: number;
  yawRad?: number;
  pitchRad?: number;
}

/**
 * Accumulates neutral-face baseline samples over the calibration window so all
 * downstream challenges evaluate relative change instead of fixed thresholds.
 */
export class CalibrationCollector {
  private readonly shapeSums: Record<string, number> = {};
  private noseSumX = 0;
  private noseSumY = 0;
  private rollSum = 0;
  private yawSum = 0;
  private pitchSum = 0;
  private count = 0;
  private elapsedMs = 0;

  constructor(private readonly targetMs: number) {}

  addSample(dtMs: number, sample: CalibrationSample | null): void {
    if (!sample) return;
    this.elapsedMs += Math.max(0, dtMs);
    this.count += 1;
    this.noseSumX += sample.nose.x;
    this.noseSumY += sample.nose.y;
    this.rollSum += sample.rollRad;
    this.yawSum += sample.yawRad ?? 0;
    this.pitchSum += sample.pitchRad ?? 0;

    for (const [key, val] of Object.entries(sample.shapes)) {
      this.shapeSums[key] = (this.shapeSums[key] ?? 0) + val;
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
    const n = Math.max(1, this.count);
    const shapes: Record<string, number> = {};
    for (const [key, sum] of Object.entries(this.shapeSums)) {
      shapes[key] = sum / n;
    }
    return {
      shapes,
      nose: {
        x: this.noseSumX / n,
        y: this.noseSumY / n,
      },
      rollRad: this.rollSum / n,
      yawRad: this.yawSum / n,
      pitchRad: this.pitchSum / n,
    };
  }
}

/**
 * Computes raw blendshape scores minus calibrated neutral baseline.
 */
export function computeBlendshapeDeltas(
  shapes: Record<string, number>,
  baselineShapes: Record<string, number>,
): Record<string, number> {
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(shapes)) {
    delta[key] = value - (baselineShapes[key] ?? 0);
  }
  return delta;
}
