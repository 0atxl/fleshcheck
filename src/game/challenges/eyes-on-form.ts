import type { BlendshapeMap } from "../../vision/blendshapes";
import { mulberry32, shuffleWithRng } from "../prng";
import type { Challenge, ChallengeContext, ChallengeResult, FaceSignal, Viewport } from "../types";
import { drawWrappedText } from "./hud";

const GAZE_THRESHOLD = 0.28;
const HEAD_YAW_THRESHOLD_RAD = 0.24; // ~14° head turn away from center form
const GAZE_HOLD_MS = 300;

interface EdgePopup {
  side: "left" | "right";
  text: string;
  startMs: number;
  endMs: number;
}

/**
 * Computes screen-space horizontal gaze deltas from calibrated baseline.
 * On unmirrored camera input, MediaPipe *Left/*Right blendshapes are anatomical
 * to the subject: looking toward the left edge of the screen moves the subject's
 * left eye outward (eyeLookOutLeft) and right eye inward (eyeLookInRight).
 */
export function computeHorizontalGaze(delta: BlendshapeMap): {
  lookLeft: number;
  lookRight: number;
} {
  const lookLeft = ((delta.eyeLookOutLeft ?? 0) + (delta.eyeLookInRight ?? 0)) / 2;
  const lookRight = ((delta.eyeLookOutRight ?? 0) + (delta.eyeLookInLeft ?? 0)) / 2;
  return { lookLeft, lookRight };
}

/**
 * Attention Audit challenge: keep eyes centered on Form 88-Z while edge popups tempt you.
 */
export class EyesOnFormChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private calloutPool: readonly string[] = ["ATTENTION LEAK"];
  private seed = 1;
  private baselineYaw = 0;

  private popups: EdgePopup[] = [];
  private leakMs = 0;
  private lastLeakSide: "left" | "right" | null = null;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.status = "running";
    this.callout = undefined;
    this.seed = ctx.seed;
    this.baselineYaw = ctx.baseline.yawRad;
    this.leakMs = 0;
    this.lastLeakSide = null;

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    const rng = mulberry32(ctx.seed);
    const texts = shuffleWithRng(ctx.copy.popups ?? ["Free stapler at desk 4."], rng);
    const count = this.durationMs <= 5_000 ? 2 : 5;
    const stepMs = (this.durationMs - 1_000) / count;

    this.popups = [];
    for (let i = 0; i < count; i++) {
      const startMs = Math.round(700 + i * stepMs);
      const endMs = Math.round(startMs + Math.min(2_100, stepMs * 0.9));
      const side: "left" | "right" = (i + Math.floor(rng() * 2)) % 2 === 0 ? "left" : "right";
      this.popups.push({
        side,
        text: texts[i % texts.length]!,
        startMs,
        endMs,
      });
    }
  }

  getActivePopup(): EdgePopup | null {
    return this.popups.find((p) => this.elapsedMs >= p.startMs && this.elapsedMs <= p.endMs) ?? null;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;

    const active = this.getActivePopup();
    const { lookLeft, lookRight } = computeHorizontalGaze(signal.delta);
    const headYawDelta = signal.pose.yaw - this.baselineYaw;
    const turnedHeadAway = Math.abs(headYawDelta) > HEAD_YAW_THRESHOLD_RAD;

    const lookedAtActive =
      active !== null &&
      ((active.side === "left" && lookLeft > GAZE_THRESHOLD) ||
        (active.side === "right" && lookRight > GAZE_THRESHOLD));

    if (lookedAtActive && active) {
      this.leakMs += clampedDt;
      this.lastLeakSide = active.side;
    } else if (turnedHeadAway) {
      this.leakMs += clampedDt;
      this.lastLeakSide = active ? active.side : headYawDelta < 0 ? "left" : "right";
    } else if (Math.max(lookLeft, lookRight) > GAZE_THRESHOLD + 0.08) {
      this.leakMs += clampedDt * 0.7;
      this.lastLeakSide = lookLeft >= lookRight ? "left" : "right";
    } else {
      this.leakMs = Math.max(0, this.leakMs - clampedDt * 1.5);
    }

    if (this.leakMs >= GAZE_HOLD_MS) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      this.callout = this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "ATTENTION LEAK";
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const active = this.getActivePopup();

    ctx.save();

    // Center compliance anchor form
    const formW = Math.min(200, vp.width * 0.42);
    const formH = 68;
    const fx = (vp.width - formW) / 2;
    const fy = vp.height - formH - 16;

    ctx.fillStyle = "rgba(246, 247, 244, 0.94)";
    ctx.fillRect(fx, fy, formW, formH);
    ctx.strokeStyle = "#1A1D1E";
    ctx.lineWidth = 2;
    ctx.strokeRect(fx, fy, formW, formH);

    ctx.fillStyle = "#E8590C";
    ctx.fillRect(fx, fy, formW, 6);

    ctx.fillStyle = "#1A1D1E";
    ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FORM 88-Z", vp.width / 2, fy + 26);

    ctx.font = "500 11px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#555B5E";
    ctx.fillText("Keep eyes fixed here.", vp.width / 2, fy + 48);

    // Edge distraction popup
    if (active) {
      const popW = Math.min(180, vp.width * 0.34);
      const popH = 68;
      const px = active.side === "left" ? 14 : vp.width - popW - 14;
      const py = Math.round(vp.height * 0.38);

      ctx.fillStyle = "#FFF9DB";
      ctx.fillRect(px, py, popW, popH);
      ctx.strokeStyle = this.lastLeakSide === active.side && this.leakMs > 0 ? "#C92A2A" : "#E8590C";
      ctx.lineWidth = 3;
      ctx.strokeRect(px, py, popW, popH);

      ctx.fillStyle = "#C2410C";
      ctx.font = "800 9px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "left";
      ctx.fillText("NOTICE", px + 10, py + 15);

      ctx.fillStyle = "#1A1D1E";
      ctx.font = "600 12px system-ui, -apple-system, sans-serif";
      drawWrappedText(ctx, active.text, px + 10, py + 42, popW - 20, 15, 3);
    }

    // Top HUD
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = this.status === "failed" ? "#C92A2A" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("FORM 88-Z · ATTENTION AUDIT", 16, 20);

    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, vp.width - 16, 20);

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
