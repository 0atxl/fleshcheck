import type { BlendshapeMap } from "../../vision/blendshapes";
import { mulberry32, shuffleWithRng } from "../prng";
import { FONT_LABEL, FONT_TYPE, THEME } from "../theme";
import type {
  Challenge,
  ChallengeContext,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  Point2D,
  Rect2D,
  Viewport,
} from "../types";
import { clampEvidenceRect, drawProgressLine, drawTimerTag, drawWrappedText } from "./hud";

const GAZE_THRESHOLD = 0.28;
const HEAD_YAW_THRESHOLD_RAD = 0.24; // ~14° head turn away from center form
const HEAD_YAW_LIMIT_DEG = 14;
const GAZE_HOLD_MS = 300;

const EYE_LANDMARKS = [33, 133, 159, 145, 362, 263, 386, 374] as const;

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
  private evidence: EvidenceMark | undefined;
  private calloutPool: readonly string[] = ["ATTENTION LEAK"];
  private seed = 1;
  private baselineYaw = 0;
  private viewport: Viewport = { width: 640, height: 480 };

  private popups: EdgePopup[] = [];
  private leakMs = 0;
  private lastLeakSide: "left" | "right" | null = null;
  private lastLeakKind: "gaze" | "yaw" = "gaze";
  private lastGazeValue = 0;
  private lastYawRad = 0;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.seed = ctx.seed;
    this.baselineYaw = ctx.baseline.yawRad;
    this.viewport = { ...ctx.viewport };
    this.leakMs = 0;
    this.lastLeakSide = null;
    this.lastLeakKind = "gaze";
    this.lastGazeValue = 0;
    this.lastYawRad = 0;

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
      this.lastLeakKind = "gaze";
      this.lastGazeValue = active.side === "left" ? lookLeft : lookRight;
    } else if (turnedHeadAway) {
      this.leakMs += clampedDt;
      this.lastLeakSide = active ? active.side : headYawDelta < 0 ? "left" : "right";
      this.lastLeakKind = "yaw";
      this.lastYawRad = Math.abs(headYawDelta);
    } else if (Math.max(lookLeft, lookRight) > GAZE_THRESHOLD + 0.08) {
      this.leakMs += clampedDt * 0.7;
      this.lastLeakSide = lookLeft >= lookRight ? "left" : "right";
      this.lastLeakKind = "gaze";
      this.lastGazeValue = Math.max(lookLeft, lookRight);
    } else {
      this.leakMs = Math.max(0, this.leakMs - clampedDt * 1.5);
    }

    if (this.leakMs >= GAZE_HOLD_MS) {
      this.status = "failed";
      const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
      this.callout = this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "ATTENTION LEAK";
      this.evidence = this.buildEyeEvidence(signal);
      return;
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  private buildEyeEvidence(signal: FaceSignal): EvidenceMark {
    const rawRect = computeEyeRegionRect(signal.landmarks, signal.faceBox, this.viewport);
    const label =
      this.lastLeakKind === "yaw"
        ? `Head turn ${Math.round((this.lastYawRad * 180) / Math.PI)}° / limit ${HEAD_YAW_LIMIT_DEG}°`
        : `Gaze ${this.lastLeakSide ?? "off"} ${this.lastGazeValue.toFixed(2)} / limit ${GAZE_THRESHOLD.toFixed(2)}`;
    return {
      rect: clampEvidenceRect(rawRect, this.viewport, 80, 40),
      label,
    };
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    const active = this.getActivePopup();

    ctx.save();

    // Center compliance anchor form
    const formW = Math.min(220, vp.width * 0.46);
    const formH = 68;
    const fx = (vp.width - formW) / 2;
    const fy = vp.height - formH - 14;

    ctx.fillStyle = THEME.paper;
    ctx.fillRect(fx, fy, formW, formH);
    ctx.fillStyle = THEME.formBlue;
    ctx.fillRect(fx, fy, formW, 5);
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(fx, fy + formH - 3, formW, 3);

    ctx.fillStyle = THEME.ink;
    ctx.font = `700 15px ${FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FORM 88-Z", vp.width / 2, fy + 27);

    ctx.font = `400 12px ${FONT_TYPE}`;
    ctx.fillStyle = THEME.inkMuted;
    ctx.fillText("Keep eyes fixed here.", vp.width / 2, fy + 48);

    // Edge distraction popup
    if (active) {
      const popW = Math.min(190, vp.width * 0.36);
      const popH = 74;
      const px = active.side === "left" ? 12 : vp.width - popW - 12;
      const py = Math.round(vp.height * 0.36);
      const leakingHere = this.lastLeakSide === active.side && this.leakMs > 0;

      ctx.fillStyle = THEME.paperLight;
      ctx.fillRect(px, py, popW, popH);
      ctx.strokeStyle = leakingHere ? THEME.stampRed : THEME.formBlue;
      ctx.lineWidth = leakingHere ? 3 : 2;
      ctx.strokeRect(px, py, popW, popH);

      ctx.fillStyle = THEME.stampRed;
      ctx.font = `700 11px ${FONT_LABEL}`;
      ctx.textAlign = "left";
      ctx.fillText("NOTICE", px + 10, py + 15);

      ctx.fillStyle = THEME.ink;
      ctx.font = `600 12px ${FONT_TYPE}`;
      drawWrappedText(ctx, active.text, px + 10, py + 44, popW - 20, 15, 3);
    }

    // Unified HUD
    drawProgressLine(ctx, vp, progress, {
      danger: this.status === "failed" || this.leakMs > 0,
    });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs));

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

function computeEyeRegionRect(
  landmarks: readonly Point2D[],
  faceBox: Rect2D,
  vp: Viewport,
): Rect2D {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const idx of EYE_LANDMARKS) {
    const p = landmarks[idx];
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (Number.isFinite(minX) && maxX > minX) {
    const padX = Math.max(16, (maxX - minX) * 0.25);
    const padY = Math.max(14, (maxY - minY) * 0.7);
    return {
      x: minX - padX,
      y: minY - padY,
      w: maxX - minX + padX * 2,
      h: maxY - minY + padY * 2,
    };
  }
  if (faceBox.w > 0 && faceBox.h > 0) {
    return {
      x: faceBox.x + faceBox.w * 0.12,
      y: faceBox.y + faceBox.h * 0.22,
      w: faceBox.w * 0.76,
      h: faceBox.h * 0.24,
    };
  }
  return {
    x: vp.width * 0.32,
    y: vp.height * 0.34,
    w: vp.width * 0.36,
    h: vp.height * 0.14,
  };
}
