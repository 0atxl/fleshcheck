import { mulberry32, shuffleWithRng } from "../prng";
import type { Baseline, Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";

const MAX_TILT_RAD = (10 * Math.PI) / 180;
const MAX_TURN_RAD = (12 * Math.PI) / 180;
const POSE_HOLD_MS = 220;
const AFFECT_HOLD_MS = 250;
const EYES_CLOSED_HOLD_MS = 600;

/**
 * Identity Imaging challenge: hold perfectly still while photo compliance rules pile up.
 */
export class PassportPhotoChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private baseline!: Baseline;
  private rules: string[] = [];
  private calloutPool: readonly string[] = ["REJECTED: EYES"];
  private seed = 1;

  private poseFailMs = 0;
  private affectFailMs = 0;
  private eyesClosedMs = 0;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.status = "running";
    this.callout = undefined;
    this.baseline = ctx.baseline;
    this.seed = ctx.seed;
    this.poseFailMs = 0;
    this.affectFailMs = 0;
    this.eyesClosedMs = 0;

    const rng = mulberry32(ctx.seed);
    const srcRules = ctx.copy.rules ?? ["Remove all expression."];
    this.rules = shuffleWithRng(srcRules, rng).slice(0, 6);
    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;

    // 1. Check held eye closure (>600ms fails; normal 150-250ms blinks pass)
    const blinkL = signal.shapes.eyeBlinkLeft ?? 0;
    const blinkR = signal.shapes.eyeBlinkRight ?? 0;
    const blinkDeltaL = signal.delta.eyeBlinkLeft ?? 0;
    const blinkDeltaR = signal.delta.eyeBlinkRight ?? 0;
    const eyesShut = (blinkL > 0.65 && blinkR > 0.65) || (blinkDeltaL > 0.38 && blinkDeltaR > 0.38);

    if (eyesShut) {
      this.eyesClosedMs += clampedDt;
    } else {
      this.eyesClosedMs = Math.max(0, this.eyesClosedMs - clampedDt * 2);
    }

    if (this.eyesClosedMs >= EYES_CLOSED_HOLD_MS) {
      this.failWith("REJECTED: EYES");
      return;
    }

    // 2. Check head pose drift relative to baseline
    const dRoll = Math.abs(signal.pose.roll - this.baseline.rollRad);
    const dYaw = Math.abs(signal.pose.yaw - this.baseline.yawRad);
    const dPitch = Math.abs(signal.pose.pitch - this.baseline.pitchRad);

    if (dRoll > MAX_TILT_RAD || dYaw > MAX_TURN_RAD || dPitch > MAX_TURN_RAD) {
      this.poseFailMs += clampedDt;
    } else {
      this.poseFailMs = Math.max(0, this.poseFailMs - clampedDt * 1.5);
    }

    if (this.poseFailMs >= POSE_HOLD_MS) {
      this.failWith(dRoll > MAX_TILT_RAD ? "REJECTED: HEAD LEVEL" : "REJECTED: POSTURE DRIFT");
      return;
    }

    // 3. Check expression leak relative to baseline
    const smileDelta = Math.max(
      signal.delta.mouthSmileLeft ?? 0,
      signal.delta.mouthSmileRight ?? 0,
    );
    const jawDelta = signal.delta.jawOpen ?? 0;
    const browDelta = Math.max(
      signal.delta.browInnerUp ?? 0,
      signal.delta.browDownLeft ?? 0,
      signal.delta.browDownRight ?? 0,
    );

    if (smileDelta > 0.14 || jawDelta > 0.18 || browDelta > 0.24) {
      this.affectFailMs += clampedDt;
    } else {
      this.affectFailMs = Math.max(0, this.affectFailMs - clampedDt * 1.5);
    }

    if (this.affectFailMs >= AFFECT_HOLD_MS) {
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      const affectVariants = this.calloutPool.filter(
        (c) => !/(EYES|EYELID|HEAD|POSTURE|CHIN)/.test(c),
      );
      const pool = affectVariants.length > 0 ? affectVariants : this.calloutPool;
      this.failWith(pool[Math.floor(rng() * pool.length)] ?? "REJECTED: AFFECT");
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  private failWith(reason: string): void {
    this.status = "failed";
    this.callout = reason;
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const activeCount = Math.min(
      this.rules.length,
      Math.max(1, Math.floor(progress * this.rules.length) + 1),
    );
    const visibleRules = this.rules.slice(Math.max(0, activeCount - 3), activeCount);

    ctx.save();

    // Passport 35x45 guide oval & eye horizon line
    const cx = vp.width / 2;
    const cy = vp.height * 0.45;
    const rx = Math.min(vp.width, vp.height) * 0.22;
    const ry = rx * 1.32;

    ctx.strokeStyle = this.status === "failed" ? "rgba(201, 42, 42, 0.9)" : "rgba(246, 247, 244, 0.65)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Eye horizon line
    ctx.beginPath();
    ctx.moveTo(cx - rx - 24, cy - ry * 0.14);
    ctx.lineTo(cx + rx + 24, cy - ry * 0.14);
    ctx.stroke();
    ctx.setLineDash([]);

    // Top HUD
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = this.status === "failed" ? "#C92A2A" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("FORM OBV-19 · IDENTITY IMAGING", 16, 20);

    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, vp.width - 16, 20);

    // Stacked compliance rules at bottom
    const margin = 16;
    const rowH = 22;
    const boxH = visibleRules.length * rowH + 18;
    const boxY = vp.height - boxH - margin;

    ctx.fillStyle = "rgba(26, 29, 30, 0.88)";
    ctx.fillRect(margin, boxY, vp.width - margin * 2, boxH);
    ctx.strokeStyle = "rgba(246, 247, 244, 0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(margin + 0.5, boxY + 0.5, vp.width - margin * 2 - 1, boxH - 1);

    ctx.textAlign = "left";
    ctx.font = "500 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    const maxRuleW = vp.width - margin * 2 - 28;
    for (let i = 0; i < visibleRules.length; i++) {
      const isNewest = i === visibleRules.length - 1;
      ctx.fillStyle = isNewest ? "#E8590C" : "#D4D8DA";
      ctx.fillText(
        `RULE ${activeCount - visibleRules.length + i + 1}: ${visibleRules[i]!}`,
        margin + 14,
        boxY + 18 + i * rowH,
        maxRuleW,
      );
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
