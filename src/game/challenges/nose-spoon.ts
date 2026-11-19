import { mulberry32, shuffleWithRng } from "../prng";
import { FONT_LABEL, FONT_TYPE, THEME } from "../theme";
import type {
  Challenge,
  ChallengeContext,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  Point2D,
  Viewport,
} from "../types";
import { clampEvidenceRect, drawProgressLine, drawPromptStrip, drawTimerTag } from "./hud";

export const MAX_SPOON_ANGLE_RAD = (38 * Math.PI) / 180;
const MAX_SPOON_ANGLE_DEG = 38;

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

function hasEyeCornerLandmarks(signal: Pick<FaceSignal, "landmarks">): boolean {
  const rightOnScreen = signal.landmarks[33];
  const leftOnScreen = signal.landmarks[263];
  if (!rightOnScreen || !leftOnScreen) return false;
  return Math.hypot(rightOnScreen.x - leftOnScreen.x, rightOnScreen.y - leftOnScreen.y) > 5;
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
  private baselineEyeRoll: number | undefined;
  private baselinePoseRoll = 0;
  private anchor: Point2D = { x: 320, y: 240 };
  private viewport: Viewport = { width: 640, height: 480 };
  private prevNoseX: number | null = null;
  private activeGustForce = 0;
  private gusts: GustWindow[] = [];
  private commentaryLines: string[] = [];
  private calloutPool: readonly string[] = ["ASSET DROPPED"];
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private seed = 1;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.seed = ctx.seed;
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.baselineEyeRoll = ctx.baseline.eyeRollRad;
    this.baselinePoseRoll = ctx.baseline.rollRad;
    this.anchor = { ...ctx.baseline.nose };
    this.viewport = { ...ctx.viewport };
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
    const lineCount = this.durationMs <= 5_000 ? 2 : 5;
    this.commentaryLines = shuffleWithRng(sourceCommentary, rng).slice(0, lineCount);
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

    // Always subtract baseline computed with the same roll estimator and sign convention
    let rawDeltaRoll: number;
    if (hasEyeCornerLandmarks(signal)) {
      const eyeRoll = computeEyeRollRad(signal);
      if (this.baselineEyeRoll === undefined) {
        this.baselineEyeRoll = eyeRoll;
      }
      rawDeltaRoll = eyeRoll - this.baselineEyeRoll;
    } else {
      rawDeltaRoll = signal.pose.roll - this.baselinePoseRoll;
    }
    const deltaRoll = clamp(rawDeltaRoll, -0.7, 0.7);

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
      this.evidence = this.buildEvidence();
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const spoonLen = Math.min(vp.width, vp.height) * 0.34;
    const failed = this.status === "failed";
    const norm = clamp(this.angle / MAX_SPOON_ANGLE_RAD, -1, 1);

    ctx.save();

    // Draw spoon + egg anchored on nose tip
    ctx.save();
    ctx.translate(this.anchor.x, this.anchor.y);
    ctx.rotate(this.angle);

    // Handle shaft
    ctx.strokeStyle = THEME.paperLight;
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -spoonLen);
    ctx.stroke();

    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-2.5, 0);
    ctx.lineTo(-2.5, -spoonLen);
    ctx.moveTo(2.5, 0);
    ctx.lineTo(2.5, -spoonLen);
    ctx.stroke();

    // Spoon bowl
    ctx.fillStyle = THEME.paperDeep;
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -spoonLen - 8, 26, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Federal asset egg
    const eggOffsetX = failed ? Math.sign(this.angle || 1) * 34 : (this.angle / MAX_SPOON_ANGLE_RAD) * 8;
    const eggOffsetY = failed ? 14 : -19;
    ctx.fillStyle = THEME.paperLight;
    ctx.strokeStyle = THEME.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(eggOffsetX, -spoonLen + eggOffsetY, 15, 19, failed ? this.angle * 0.7 : 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = THEME.stampRed;
    ctx.font = `700 8px ${FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("ASSET", eggOffsetX, -spoonLen + eggOffsetY);
    ctx.restore();

    // Nose anchor pin
    ctx.fillStyle = THEME.stampRed;
    ctx.strokeStyle = THEME.paperLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.anchor.x, this.anchor.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Unified HUD
    drawProgressLine(ctx, vp, progress, { danger: failed || Math.abs(norm) > 0.72 });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs));

    // Tilt meter under the burned-in CCTV clock on the top-left
    const deg = Math.round((this.angle * 180) / Math.PI);
    const gaugeW = Math.min(184, vp.width * 0.38);
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(12, 46, gaugeW, 40);
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(12, 84, gaugeW, 2);

    const markerX = 12 + gaugeW / 2 + norm * (gaugeW / 2 - 10);
    ctx.fillStyle = "rgba(26, 26, 24, 0.25)";
    ctx.fillRect(12 + gaugeW / 2 - 1, 51, 2, 14);
    ctx.fillStyle = Math.abs(norm) > 0.72 ? THEME.stampRed : THEME.formBlue;
    ctx.fillRect(markerX - 4, 51, 8, 14);

    ctx.font = `700 11px ${FONT_TYPE}`;
    ctx.fillStyle = Math.abs(norm) > 0.72 ? THEME.stampRed : THEME.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`Tilt ${deg > 0 ? `+${deg}` : deg}° / ±${MAX_SPOON_ANGLE_DEG}°`, 18, 74);

    if (Math.abs(this.activeGustForce) > 0.2) {
      const windLabel = this.activeGustForce > 0 ? "CROSSWIND >>>" : "<<< CROSSWIND";
      ctx.fillStyle = THEME.stampRed;
      ctx.fillRect(vp.width - 144, 52, 132, 24);
      ctx.fillStyle = THEME.paperLight;
      ctx.font = `700 12px ${FONT_LABEL}`;
      ctx.textAlign = "center";
      ctx.fillText(windLabel, vp.width - 78, 65);
    }

    // Commentary paper strip
    const lineIdx = Math.min(
      this.commentaryLines.length - 1,
      Math.floor(progress * this.commentaryLines.length),
    );
    const line = this.commentaryLines[lineIdx];
    if (line) {
      drawPromptStrip(ctx, vp, line, { label: "FORM 44-A · ASSET HANDLING", maxLines: 2 });
    }

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    return {
      status: this.status,
      progress,
      ...(this.callout !== undefined ? { callout: this.callout } : {}),
      ...(this.evidence !== undefined ? { evidence: this.evidence } : {}),
    };
  }

  private buildEvidence(): EvidenceMark {
    const spoonLen = Math.min(this.viewport.width, this.viewport.height) * 0.34;
    const tipDist = spoonLen + 26;
    const tipX = this.anchor.x + Math.sin(this.angle) * tipDist;
    const tipY = this.anchor.y - Math.cos(this.angle) * tipDist;
    const pad = 28;
    const minX = Math.min(this.anchor.x, tipX) - pad;
    const maxX = Math.max(this.anchor.x, tipX) + pad;
    const minY = Math.min(this.anchor.y, tipY) - pad;
    const maxY = Math.max(this.anchor.y, tipY) + pad;
    const deg = Math.round((Math.abs(this.angle) * 180) / Math.PI);
    return {
      rect: clampEvidenceRect(
        { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        this.viewport,
        72,
        72,
      ),
      label: `Spoon ${deg}° / limit ${MAX_SPOON_ANGLE_DEG}°`,
    };
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
