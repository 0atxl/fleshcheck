import { mulberry32, shuffleWithRng } from "../prng";
import type { Baseline, Challenge, ChallengeContext, ChallengeResult, FaceSignal, Point2D, Viewport } from "../types";

export const MAX_SPOON_ANGLE_RAD = (38 * Math.PI) / 180;

interface GustWindow {
  startMs: number;
  endMs: number;
  force: number;
}

/**
 * Extracts screen-space head roll from outer eye corners (33 / 263),
 * falling back to facial transformation roll when landmarks are unavailable.
 */
export function computeEyeRollRad(signal: Pick<FaceSignal, "landmarks" | "pose">): number {
  const rightOnScreen = signal.landmarks[33];
  const leftOnScreen = signal.landmarks[263];
  if (rightOnScreen && leftOnScreen) {
    const dx = rightOnScreen.x - leftOnScreen.x;
    const dy = rightOnScreen.y - leftOnScreen.y;
    if (Math.hypot(dx, dy) > 5) {
      return Math.atan2(dy, dx);
    }
  }
  return signal.pose.roll;
}

/**
 * Asset Handling challenge: balance a regulation spoon carrying a federal egg
 * on the nose tip against seeded crosswind gusts.
 */
export class NoseSpoonChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private angle = 0;
  private angularVel = 0;
  private baselineRoll = 0;
  private anchor: Point2D = { x: 320, y: 240 };
  private prevNoseX: number | null = null;
  private activeGustForce = 0;
  private gusts: GustWindow[] = [];
  private commentaryLines: string[] = [];
  private calloutPool: readonly string[] = ["ASSET DROPPED"];
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private seed = 1;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.seed = ctx.seed;
    this.status = "running";
    this.callout = undefined;
    this.baselineRoll = ctx.baseline.rollRad;
    this.anchor = { ...ctx.baseline.nose };
    this.prevNoseX = null;

    const rng = mulberry32(ctx.seed);
    this.angle = (rng() > 0.5 ? 1 : -1) * 0.04;
    this.angularVel = 0;
    this.activeGustForce = 0;

    // Seed proportional wind gusts across the inspection window
    const scale = this.durationMs / 12_000;
    this.gusts = [1_200, 4_100, 7_000, 9_600].map((baseStart) => {
      const startMs = Math.round(baseStart * scale);
      const endMs = Math.round((baseStart + 1_450) * scale);
      const dir = rng() > 0.5 ? 1 : -1;
      const strength = 1.25 + rng() * 0.75;
      return { startMs, endMs, force: dir * strength };
    });

    const sourceCommentary = ctx.copy.commentary ?? ["Keep the federal egg above your bridge."];
    this.commentaryLines = shuffleWithRng(sourceCommentary, rng).slice(0, 5);
    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }
  }

  getAngleRad(): number {
    return this.angle;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    const dtSec = clampedDt / 1000;
    this.elapsedMs += clampedDt;
    this.anchor = { ...signal.nose };

    const currentRoll = computeEyeRollRad(signal);
    const deltaRoll = clamp(currentRoll - this.baselineRoll, -0.7, 0.7);

    let noseVelX = 0;
    if (this.prevNoseX !== null) {
      noseVelX = clamp((signal.nose.x - this.prevNoseX) / dtSec, -500, 500);
    }
    this.prevNoseX = signal.nose.x;

    // Evaluate active seeded wind gust envelope
    this.activeGustForce = 0;
    for (const g of this.gusts) {
      if (this.elapsedMs >= g.startMs && this.elapsedMs <= g.endMs) {
        const u = (this.elapsedMs - g.startMs) / Math.max(1, g.endMs - g.startMs);
        this.activeGustForce = g.force * Math.sin(Math.PI * u);
        break;
      }
    }

    // Inverted pendulum on nose tip: tilting/moving under lean counters tip
    const gravityTorque = 3.1 * Math.sin(this.angle);
    const controlTorque = -4.6 * deltaRoll - 0.0045 * noseVelX;
    const totalAccel = gravityTorque + controlTorque + this.activeGustForce;

    this.angularVel = (this.angularVel + totalAccel * dtSec) * Math.exp(-3.3 * dtSec);
    this.angle += this.angularVel * dtSec;

    if (Math.abs(this.angle) > MAX_SPOON_ANGLE_RAD) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      this.callout = this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "ASSET DROPPED";
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const spoonLen = Math.min(vp.width, vp.height) * 0.34;
    const failed = this.status === "failed";

    ctx.save();

    // Draw spoon + egg anchored on nose tip
    ctx.save();
    ctx.translate(this.anchor.x, this.anchor.y);
    ctx.rotate(this.angle);

    // Handle shaft
    ctx.strokeStyle = "#E4E7E4";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -spoonLen);
    ctx.stroke();

    ctx.strokeStyle = "#1A1D1E";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2.5, 0);
    ctx.lineTo(-2.5, -spoonLen);
    ctx.moveTo(2.5, 0);
    ctx.lineTo(2.5, -spoonLen);
    ctx.stroke();

    // Spoon bowl
    ctx.fillStyle = "#D4D8DA";
    ctx.strokeStyle = "#1A1D1E";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -spoonLen - 8, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Federal asset egg
    const eggOffsetX = failed ? Math.sign(this.angle || 1) * 34 : (this.angle / MAX_SPOON_ANGLE_RAD) * 8;
    const eggOffsetY = failed ? 14 : -19;
    ctx.fillStyle = "#FFF7E6";
    ctx.strokeStyle = "#1A1D1E";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(eggOffsetX, -spoonLen + eggOffsetY, 15, 19, failed ? this.angle * 0.7 : 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#C92A2A";
    ctx.font = "700 7px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ASSET", eggOffsetX, -spoonLen + eggOffsetY);
    ctx.restore();

    // Nose anchor pin
    ctx.fillStyle = "#E8590C";
    ctx.beginPath();
    ctx.arc(this.anchor.x, this.anchor.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Top HUD bar
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = failed ? "#C92A2A" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("FORM 44-A · ASSET HANDLING", 16, 20);

    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, vp.width - 16, 20);

    // Tilt meter & wind indicator
    const deg = Math.round((this.angle * 180) / Math.PI);
    const gaugeW = Math.min(180, vp.width * 0.36);
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(16, 58, gaugeW, 24);

    const norm = clamp(this.angle / MAX_SPOON_ANGLE_RAD, -1, 1);
    const markerX = 16 + gaugeW / 2 + norm * (gaugeW / 2 - 8);
    ctx.fillStyle = "rgba(246, 247, 244, 0.25)";
    ctx.fillRect(16 + gaugeW / 2 - 1, 61, 2, 18);
    ctx.fillStyle = Math.abs(norm) > 0.72 ? "#C92A2A" : "#E8590C";
    ctx.fillRect(markerX - 4, 61, 8, 18);

    ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textAlign = "left";
    ctx.fillText(`TILT ${deg > 0 ? `+${deg}` : deg}° / ±38°`, 22, 92);

    if (Math.abs(this.activeGustForce) > 0.2) {
      const windLabel = this.activeGustForce > 0 ? "CROSSWIND >>>" : "<<< CROSSWIND";
      ctx.fillStyle = "rgba(232, 89, 12, 0.88)";
      ctx.fillRect(vp.width - 148, 58, 132, 24);
      ctx.fillStyle = "#FFFFFF";
      ctx.textAlign = "center";
      ctx.fillText(windLabel, vp.width - 82, 70);
    }

    // Commentary banner
    const lineIdx = Math.min(
      this.commentaryLines.length - 1,
      Math.floor(progress * this.commentaryLines.length),
    );
    const line = this.commentaryLines[lineIdx];
    if (line) {
      const margin = 16;
      const boxH = 54;
      const boxY = vp.height - boxH - margin;
      ctx.fillStyle = "rgba(26, 29, 30, 0.86)";
      ctx.fillRect(margin, boxY, vp.width - margin * 2, boxH);
      ctx.fillStyle = "#F6F7F4";
      ctx.font = "500 14px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(line, vp.width / 2, boxY + boxH / 2);
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    if (this.callout !== undefined) {
      return { status: this.status, progress, callout: this.callout };
    }
    return { status: this.status, progress };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export type { Baseline };
