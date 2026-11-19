import { CALIBRATION_MS, MAX_PAUSES_PER_TRY } from "../config";
import { CalibrationCollector } from "../vision/calibration";
import { coverRect } from "../vision/geometry";
import type { FaceTracker } from "../vision/tracker";
import { drawFaceWireframe } from "../vision/wireframe";
import { computeHumanPct } from "./scoring";
import type { Baseline, Challenge, ChallengeManifest, TryRecord, Viewport } from "./types";

const FAIL_SHAKE_MS = 240;
const HAVE_CURRENT_DATA = 2;

export type GamePhase =
  | "IDLE"
  | "CALIBRATING"
  | "ACTIVE"
  | "PAUSED"
  | "VERDICT";

export interface LoopVerdict {
  passed: boolean;
  pct: number;
  paused: boolean;
  callout: string;
  elapsedMs: number;
  durationMs: number;
  snapshot: HTMLCanvasElement;
  roundRecords?: TryRecord[];
}

export interface LoopCallbacks {
  onPhaseChange(phase: GamePhase): void;
  onRoundActive?(canvas: HTMLCanvasElement): void;
  onVerdict(verdict: LoopVerdict): void;
  playAlertBeep?(): void;
  playStampThud?(): void;
  playPassChime?(): void;
  playRoundAdvance?(): void;
  playMilestone?(): void;
}

/**
 * Single requestAnimationFrame loop driving video rendering, calibration,
 * pause-on-loss logic, challenge physics, fail impact shake, and freeze-frame capture.
 */
export class GameLoop {
  private phase: GamePhase = "IDLE";
  private rafId = 0;
  private lastFrameMs = 0;
  private activeElapsedMs = 0;
  private pausesUsed = 0;
  private pausedBefore = false;
  private challenge: Challenge | null = null;
  private baseline: Baseline | null = null;
  private calibration = new CalibrationCollector(CALIBRATION_MS);
  private shakeRemainingMs = 0;
  private pendingVerdict: LoopVerdict | null = null;
  private readonly snapshotCanvas: HTMLCanvasElement;
  private readonly firstSubFailCanvas: HTMLCanvasElement;
  private hasSubFailSnapshot = false;
  private seenSubRounds = 0;
  private seenMilestones = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly video: HTMLVideoElement,
    private readonly tracker: FaceTracker,
    private readonly manifest: ChallengeManifest,
    private readonly seed: number,
    private readonly callbacks: LoopCallbacks,
    private readonly reducedMotion = false,
  ) {
    this.snapshotCanvas = document.createElement("canvas");
    this.firstSubFailCanvas = document.createElement("canvas");
  }

  start(): void {
    this.stop();
    this.activeElapsedMs = 0;
    this.pausesUsed = 0;
    this.pausedBefore = false;
    this.shakeRemainingMs = 0;
    this.pendingVerdict = null;
    this.challenge = null;
    this.baseline = null;
    this.hasSubFailSnapshot = false;
    this.seenSubRounds = 0;
    this.seenMilestones = 0;
    this.calibration = new CalibrationCollector(CALIBRATION_MS);
    this.tracker.resetLoss();
    this.setPhase("CALIBRATING");
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.pendingVerdict = null;
    this.shakeRemainingMs = 0;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  releaseSnapshot(): void {
    this.snapshotCanvas.width = 0;
    this.snapshotCanvas.height = 0;
    this.firstSubFailCanvas.width = 0;
    this.firstSubFailCanvas.height = 0;
  }

  private setPhase(next: GamePhase): void {
    if (this.phase === next) return;
    this.phase = next;
    this.callbacks.onPhaseChange(next);
  }

  private tick = (nowMs: number): void => {
    const dtMs = Math.min(100, Math.max(0, nowMs - this.lastFrameMs));
    this.lastFrameMs = nowMs;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const vp: Viewport = { width: this.canvas.width, height: this.canvas.height };

    // Brief frozen impact shake after a failed verdict before switching to evidence card
    if (this.phase === "VERDICT" && this.pendingVerdict) {
      this.shakeRemainingMs = Math.max(0, this.shakeRemainingMs - dtMs);
      this.drawFailImpactFrame(ctx, vp);
      if (this.shakeRemainingMs <= 0) {
        const verdict = this.pendingVerdict;
        this.pendingVerdict = null;
        this.rafId = 0;
        this.callbacks.onVerdict(verdict);
        return;
      }
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    const rect = coverRect(this.video.videoWidth || vp.width, this.video.videoHeight || vp.height, vp.width, vp.height);

    // Draw mirrored camera feed
    ctx.save();
    if (this.video.readyState >= HAVE_CURRENT_DATA) {
      ctx.save();
      ctx.translate(rect.ox + rect.dw, rect.oy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.video, 0, 0, rect.dw, rect.dh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#1A1D1E";
      ctx.fillRect(0, 0, vp.width, vp.height);
    }

    const frame = this.tracker.step(this.video, nowMs, dtMs, rect, this.baseline, true);

    if (frame.signal.tracked) {
      drawFaceWireframe(ctx, frame.signal.landmarks);
    }

    if (this.phase === "CALIBRATING") {
      if (frame.signal.tracked) {
        this.calibration.addSample(dtMs, {
          shapes: frame.rawShapes,
          nose: frame.rawNose,
          rollRad: frame.rawRoll,
          ...(frame.rawEyeRoll !== undefined ? { eyeRollRad: frame.rawEyeRoll } : {}),
          yawRad: frame.rawYaw,
          pitchRad: frame.rawPitch,
        });
      }
      this.drawCalibrationOverlay(ctx, vp, this.calibration.progress, frame.signal.tracked);

      if (this.calibration.isDone()) {
        this.baseline = this.calibration.finalize();
        this.challenge = this.manifest.create();
        this.challenge.init({
          seed: this.seed,
          baseline: this.baseline,
          copy: this.manifest.copy,
          viewport: vp,
          durationMs: this.manifest.durationMs,
        });
        this.setPhase("ACTIVE");
        this.callbacks.onRoundActive?.(this.canvas);
      }
    } else if (this.phase === "ACTIVE" || this.phase === "PAUSED") {
      if (frame.faceLost) {
        if (!this.pausedBefore) {
          this.pausedBefore = true;
          this.pausesUsed += 1;
          this.challenge?.onPause?.();
          this.callbacks.playAlertBeep?.();
          if (this.pausesUsed > MAX_PAUSES_PER_TRY) {
            this.finishVerdict(ctx, vp, false, "UNTRACKED SUBJECT");
            ctx.restore();
            return;
          }
          this.setPhase("PAUSED");
        }
        this.drawPausedOverlay(ctx, vp);
      } else {
        if (this.pausedBefore) {
          this.pausedBefore = false;
          this.setPhase("ACTIVE");
        }
        if (this.challenge) {
          this.activeElapsedMs += Math.min(80, Math.max(0, dtMs));
          this.challenge.update(dtMs, frame.signal);
          this.challenge.draw(ctx, vp);

          const res = this.challenge.getResult();
          let advancedSubRound = false;
          if (res.roundRecords && res.roundRecords.length > this.seenSubRounds) {
            const latestRound = res.roundRecords[res.roundRecords.length - 1];
            this.seenSubRounds = res.roundRecords.length;
            advancedSubRound = true;
            if (latestRound && !latestRound.passed) {
              if (!this.hasSubFailSnapshot) {
                this.firstSubFailCanvas.width = vp.width;
                this.firstSubFailCanvas.height = vp.height;
                this.firstSubFailCanvas.getContext("2d")?.drawImage(this.canvas, 0, 0);
                this.hasSubFailSnapshot = true;
              }
              if (res.status === "running") {
                this.callbacks.playStampThud?.();
              }
            } else if (res.status === "running") {
              this.callbacks.playRoundAdvance?.();
            }
          }

          if (res.milestones !== undefined && res.milestones > this.seenMilestones) {
            this.seenMilestones = res.milestones;
            if (res.status === "running" && !advancedSubRound) {
              this.callbacks.playMilestone?.();
            }
          }

          if (res.status === "failed" || res.status === "passed") {
            this.finishVerdict(
              ctx,
              vp,
              res.status === "passed",
              res.callout ?? (res.status === "passed" ? "COMPLIANCE VERIFIED" : "VERIFICATION FAILED"),
            );
            ctx.restore();
            return;
          }
        }
      }
    }

    ctx.restore();
    if (this.phase !== "VERDICT") {
      this.rafId = requestAnimationFrame(this.tick);
    }
  };

  private finishVerdict(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    passed: boolean,
    callout: string,
  ): void {
    const res = this.challenge?.getResult() ?? { status: "failed", progress: 0 };
    const status = passed ? "passed" : "failed";
    const pct = computeHumanPct(res.progress, status);

    this.snapshotCanvas.width = vp.width;
    this.snapshotCanvas.height = vp.height;
    const snapCtx = this.snapshotCanvas.getContext("2d");
    if (snapCtx) {
      if (this.hasSubFailSnapshot && this.firstSubFailCanvas.width > 0) {
        snapCtx.drawImage(this.firstSubFailCanvas, 0, 0);
      } else {
        snapCtx.drawImage(this.canvas, 0, 0);
      }
    }

    if (!passed) {
      this.callbacks.playStampThud?.();
    } else {
      this.callbacks.playPassChime?.();
    }

    const elapsedMs = Math.min(this.manifest.durationMs, Math.round(this.activeElapsedMs));
    const verdict: LoopVerdict = {
      passed,
      pct,
      paused: this.pausesUsed > 0,
      callout,
      elapsedMs,
      durationMs: this.manifest.durationMs,
      snapshot: this.snapshotCanvas,
      ...(res.roundRecords ? { roundRecords: res.roundRecords } : {}),
    };

    this.setPhase("VERDICT");

    if (!passed && !this.reducedMotion) {
      this.shakeRemainingMs = FAIL_SHAKE_MS;
      this.pendingVerdict = verdict;
      this.drawFailImpactFrame(ctx, vp);
      this.rafId = requestAnimationFrame(this.tick);
      return;
    }

    // Draw verdict tint on live canvas briefly while frozen
    ctx.save();
    ctx.fillStyle = passed ? "rgba(35, 112, 50, 0.25)" : "rgba(201, 42, 42, 0.25)";
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.restore();

    this.rafId = 0;
    this.callbacks.onVerdict(verdict);
  }

  private drawFailImpactFrame(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const amp = (this.shakeRemainingMs / FAIL_SHAKE_MS) * 8;
    const ox = (Math.random() - 0.5) * amp * 2;
    const oy = (Math.random() - 0.5) * amp * 2;

    ctx.save();
    ctx.fillStyle = "#1A1D1E";
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.translate(ox, oy);
    if (this.snapshotCanvas.width > 0) {
      ctx.drawImage(this.snapshotCanvas, 0, 0);
    }
    ctx.fillStyle = "rgba(201, 42, 42, 0.24)";
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.restore();
  }

  private drawCalibrationOverlay(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    progress: number,
    tracked: boolean,
  ): void {
    ctx.save();
    ctx.fillStyle = "rgba(26, 29, 30, 0.78)";
    ctx.fillRect(0, 0, vp.width, 64);

    ctx.fillStyle = "#F6F7F4";
    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      tracked ? "HOLD STILL · CALIBRATING FLESH" : "POSITION FACE IN FRAME",
      vp.width / 2,
      26,
    );

    const barW = Math.min(240, vp.width - 64);
    const barX = (vp.width - barW) / 2;
    ctx.fillStyle = "rgba(246, 247, 244, 0.2)";
    ctx.fillRect(barX, 44, barW, 6);
    ctx.fillStyle = "#E8590C";
    ctx.fillRect(barX, 44, barW * progress, 6);
    ctx.restore();
  }

  private drawPausedOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    ctx.save();
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, vp.height);

    ctx.fillStyle = "#F6F7F4";
    ctx.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBJECT LOST · RETURN TO FRAME", vp.width / 2, vp.height / 2 - 12);

    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#E8590C";
    ctx.fillText(
      `PAUSE ${Math.min(this.pausesUsed, MAX_PAUSES_PER_TRY)} OF ${MAX_PAUSES_PER_TRY}`,
      vp.width / 2,
      vp.height / 2 + 16,
    );
    ctx.restore();
  }
}
