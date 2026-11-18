import { CALIBRATION_MS, MAX_PAUSES_PER_TRY } from "../config";
import { CalibrationCollector } from "../vision/calibration";
import { coverRect } from "../vision/geometry";
import type { FaceTracker } from "../vision/tracker";
import { drawFaceWireframe } from "../vision/wireframe";
import { computeHumanPct } from "./scoring";
import type { Baseline, Challenge, ChallengeManifest, Point2D, TryRecord, Viewport } from "./types";

export type GamePhase =
  | "IDLE"
  | "LOADING"
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
  landmarks: Point2D[];
  roundRecords?: TryRecord[];
}

export interface LoopCallbacks {
  onPhaseChange(phase: GamePhase): void;
  onRoundActive?(canvas: HTMLCanvasElement): void;
  onPauseUsed?(count: number): void;
  onVerdict(verdict: LoopVerdict): void;
  playAlertBeep?(): void;
  playStampThud?(): void;
  playPassChime?(): void;
  playRoundAdvance?(): void;
}

/**
 * Single requestAnimationFrame loop driving video rendering, calibration,
 * pause-on-loss logic, challenge physics, and freeze-frame capture.
 */
export class GameLoop {
  private phase: GamePhase = "IDLE";
  private rafId = 0;
  private lastFrameMs = 0;
  private pausesUsed = 0;
  private pausedBefore = false;
  private challenge: Challenge | null = null;
  private baseline: Baseline | null = null;
  private calibration = new CalibrationCollector(CALIBRATION_MS);
  private shakeRemainingMs = 0;
  private readonly snapshotCanvas: HTMLCanvasElement;
  private readonly firstSubFailCanvas: HTMLCanvasElement;
  private hasSubFailSnapshot = false;
  private seenSubRounds = 0;
  private latestLandmarks: Point2D[] = [];

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
    this.pausesUsed = 0;
    this.pausedBefore = false;
    this.shakeRemainingMs = 0;
    this.latestLandmarks = [];
    this.challenge = null;
    this.baseline = null;
    this.hasSubFailSnapshot = false;
    this.seenSubRounds = 0;
    this.calibration = new CalibrationCollector(CALIBRATION_MS);
    this.tracker.resetLoss();
    this.setPhase("CALIBRATING");
    this.lastFrameMs = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
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
    const rect = coverRect(this.video.videoWidth || vp.width, this.video.videoHeight || vp.height, vp.width, vp.height);

    // Draw mirrored camera feed
    ctx.save();
    if (this.shakeRemainingMs > 0 && !this.reducedMotion) {
      this.shakeRemainingMs = Math.max(0, this.shakeRemainingMs - dtMs);
      const amp = (this.shakeRemainingMs / 240) * 8;
      ctx.translate((Math.random() - 0.5) * amp * 2, (Math.random() - 0.5) * amp * 2);
    }
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
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
      this.latestLandmarks = frame.signal.landmarks;
      drawFaceWireframe(ctx, frame.signal.landmarks);
    }

    if (this.phase === "CALIBRATING") {
      if (frame.signal.tracked) {
        this.calibration.addSample(dtMs, {
          shapes: frame.rawShapes,
          nose: frame.rawNose,
          rollRad: frame.rawRoll,
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
          this.callbacks.onPauseUsed?.(this.pausesUsed);
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
          this.challenge.update(dtMs, frame.signal);
          this.challenge.draw(ctx, vp);

          const res = this.challenge.getResult();
          if (res.roundRecords && res.roundRecords.length > this.seenSubRounds) {
            const latestRound = res.roundRecords[res.roundRecords.length - 1];
            this.seenSubRounds = res.roundRecords.length;
            if (latestRound && !latestRound.passed) {
              if (!this.hasSubFailSnapshot) {
                this.firstSubFailCanvas.width = vp.width;
                this.firstSubFailCanvas.height = vp.height;
                this.firstSubFailCanvas.getContext("2d")?.drawImage(this.canvas, 0, 0);
                this.hasSubFailSnapshot = true;
              }
              this.callbacks.playStampThud?.();
            } else {
              this.callbacks.playRoundAdvance?.();
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
      this.shakeRemainingMs = this.reducedMotion ? 0 : 240;
      this.callbacks.playStampThud?.();
    } else {
      this.callbacks.playPassChime?.();
    }

    // Draw verdict banner on live canvas briefly while frozen
    ctx.save();
    ctx.fillStyle = passed ? "rgba(43, 138, 62, 0.25)" : "rgba(201, 42, 42, 0.25)";
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.restore();

    this.setPhase("VERDICT");
    this.callbacks.onVerdict({
      passed,
      pct,
      paused: this.pausesUsed > 0,
      callout,
      elapsedMs: Math.round(res.progress * this.manifest.durationMs),
      durationMs: this.manifest.durationMs,
      snapshot: this.snapshotCanvas,
      landmarks: this.latestLandmarks,
      ...(res.roundRecords ? { roundRecords: res.roundRecords } : {}),
    });
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
