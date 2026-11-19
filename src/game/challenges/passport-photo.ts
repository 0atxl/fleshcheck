import { mulberry32, shuffleWithRng } from "../prng";
import { FONT_LABEL, FONT_TYPE, THEME } from "../theme";
import type {
  Baseline,
  Challenge,
  ChallengeContext,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  Rect2D,
  Viewport,
} from "../types";
import { clampEvidenceRect, drawProgressLine, drawTimerTag } from "./hud";

const MAX_TILT_RAD = (10 * Math.PI) / 180;
const MAX_TURN_RAD = (12 * Math.PI) / 180;
const POSE_HOLD_MS = 220;
const AFFECT_HOLD_MS = 250;
const EYES_CLOSED_HOLD_MS = 600;
const SMILE_LIMIT = 0.14;
const JAW_LIMIT = 0.18;
const BROW_LIMIT = 0.24;

/**
 * Identity Imaging challenge: hold perfectly still while photo compliance rules pile up.
 */
export class PassportPhotoChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private baseline!: Baseline;
  private viewport: Viewport = { width: 640, height: 480 };
  private lastFaceBox: Rect2D = { x: 0, y: 0, w: 0, h: 0 };
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
    this.evidence = undefined;
    this.baseline = ctx.baseline;
    this.viewport = { ...ctx.viewport };
    this.lastFaceBox = { x: 0, y: 0, w: 0, h: 0 };
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
    this.lastFaceBox = signal.faceBox;

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
      const heldSec = (this.eyesClosedMs / 1000).toFixed(1);
      this.failWith("REJECTED: EYES", `Eyes closed ${heldSec}s / limit 0.6s`);
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
      if (dRoll > MAX_TILT_RAD) {
        const deg = Math.round((dRoll * 180) / Math.PI);
        this.failWith("REJECTED: HEAD LEVEL", `Head tilt ${deg}° / limit 10°`);
      } else {
        const deg = Math.round((Math.max(dYaw, dPitch) * 180) / Math.PI);
        this.failWith("REJECTED: POSTURE DRIFT", `Head turn ${deg}° / limit 12°`);
      }
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

    if (smileDelta > SMILE_LIMIT || jawDelta > JAW_LIMIT || browDelta > BROW_LIMIT) {
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
      const reason = pool[Math.floor(rng() * pool.length)] ?? "REJECTED: AFFECT";

      const smileRatio = smileDelta / SMILE_LIMIT;
      const jawRatio = jawDelta / JAW_LIMIT;
      const browRatio = browDelta / BROW_LIMIT;
      let label: string;
      if (smileRatio >= jawRatio && smileRatio >= browRatio) {
        label = `Smile ${smileDelta.toFixed(2)} / limit ${SMILE_LIMIT.toFixed(2)}`;
      } else if (jawRatio >= browRatio) {
        label = `Jaw ${jawDelta.toFixed(2)} / limit ${JAW_LIMIT.toFixed(2)}`;
      } else {
        label = `Brow ${browDelta.toFixed(2)} / limit ${BROW_LIMIT.toFixed(2)}`;
      }
      this.failWith(reason, label);
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  private failWith(reason: string, evidenceLabel: string): void {
    this.status = "failed";
    this.callout = reason;
    const fallbackRect: Rect2D = {
      x: this.viewport.width * 0.28,
      y: this.viewport.height * 0.2,
      w: this.viewport.width * 0.44,
      h: this.viewport.height * 0.5,
    };
    const rect = this.lastFaceBox.w > 0 && this.lastFaceBox.h > 0 ? this.lastFaceBox : fallbackRect;
    this.evidence = {
      rect: clampEvidenceRect(rect, this.viewport, 80, 90),
      label: evidenceLabel,
    };
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const compact = vp.width < 520;
    const activeCount = Math.min(
      this.rules.length,
      Math.max(1, Math.floor(progress * this.rules.length) + 1),
    );
    const visibleRules = this.rules.slice(Math.max(0, activeCount - 3), activeCount);

    ctx.save();

    // Passport 35x45 guide oval & eye horizon line
    const cx = vp.width / 2;
    const cy = vp.height * 0.44;
    const rx = Math.min(vp.width, vp.height) * 0.22;
    const ry = rx * 1.32;

    ctx.strokeStyle = this.status === "failed" ? THEME.stampRed : THEME.paper;
    ctx.globalAlpha = this.status === "failed" ? 0.95 : 0.78;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Eye horizon line
    ctx.beginPath();
    ctx.moveTo(cx - rx - 24, cy - ry * 0.14);
    ctx.lineTo(cx + rx + 24, cy - ry * 0.14);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Unified HUD
    drawProgressLine(ctx, vp, progress, { danger: this.status === "failed" });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs));

    // Stacked compliance rules on a paper slip at bottom
    const margin = 14;
    const padX = 14;
    const rowH = compact ? 22 : 24;
    const boxW = vp.width - margin * 2;
    const boxH = visibleRules.length * rowH + 22;
    const boxY = vp.height - boxH - margin;

    ctx.fillStyle = THEME.paper;
    ctx.fillRect(margin, boxY, boxW, boxH);
    ctx.fillStyle = this.status === "failed" ? THEME.stampRed : THEME.ink;
    ctx.fillRect(margin, boxY + boxH - 3, boxW, 3);

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const maxRuleW = boxW - padX * 2;
    for (let i = 0; i < visibleRules.length; i++) {
      const isNewest = i === visibleRules.length - 1;
      const ruleNum = activeCount - visibleRules.length + i + 1;
      const y = boxY + 18 + i * rowH;

      const prefix = `RULE ${ruleNum}: `;
      ctx.font = `700 ${compact ? 12 : 13}px ${FONT_LABEL}`;
      ctx.fillStyle = isNewest ? THEME.formBlue : THEME.inkMuted;
      ctx.fillText(prefix, margin + padX, y);
      const prefixW = ctx.measureText(prefix).width;

      ctx.font = `${isNewest ? 700 : 400} ${compact ? 13 : 14}px ${FONT_TYPE}`;
      ctx.fillStyle = isNewest ? THEME.ink : THEME.inkMuted;
      ctx.fillText(visibleRules[i]!, margin + padX + prefixW, y, Math.max(40, maxRuleW - prefixW));
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
}
