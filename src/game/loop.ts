import { CALIBRATION_MS, MAX_PAUSES_PER_TRY } from "../config";
import { drawEvidenceAnnotation } from "../output/annotation";
import { blitStamp, createStampBitmap, pickStampText, stampColor } from "../output/stamp";
import { CalibrationCollector } from "../vision/calibration";
import { coverRect } from "../vision/geometry";
import type { FaceTracker } from "../vision/tracker";
import { drawFaceWireframe } from "../vision/wireframe";
import { computeHumanPct } from "./scoring";
import { mulberry32 } from "./prng";
import { FONT_LABEL, FONT_TYPE, THEME } from "./theme";
import type { Baseline, Challenge, ChallengeManifest, Rect2D, TryRecord, Viewport } from "./types";

/** Stamp slam timeline (ms). The stamp lands at APPROACH, the frame holds, then shakes. */
export const SLAM_APPROACH_MS = 150;
export const SLAM_FREEZE_MS = 80;
export const SLAM_SHAKE_MS = 320;
export const SLAM_TOTAL_FAIL_MS = 1_100;
export const SLAM_TOTAL_PASS_MS = 800;

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

export interface GameLoopOptions {
  /** Burned into the corner of the camera feed, e.g. "CASE #12". */
  caseLabel?: string;
}

interface SlamState {
  passed: boolean;
  elapsedMs: number;
  totalMs: number;
  impacted: boolean;
  stamp: HTMLCanvasElement | null;
  color: string;
  cx: number;
  cy: number;
  width: number;
  splats: Array<{ dx: number; dy: number; r: number }>;
}

/**
 * Single requestAnimationFrame loop driving video rendering, calibration,
 * pause-on-loss logic, challenge physics, the stamp-slam verdict sequence,
 * and freeze-frame capture.
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
  private pendingVerdict: LoopVerdict | null = null;
  private slam: SlamState | null = null;
  private lastFace: Rect2D | null = null;
  private scanPattern: CanvasPattern | null = null;
  private readonly snapshotCanvas: HTMLCanvasElement;
  private readonly firstSubFailCanvas: HTMLCanvasElement;
  private readonly cleanCanvas: HTMLCanvasElement;
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
    private readonly options: GameLoopOptions = {},
  ) {
    this.snapshotCanvas = document.createElement("canvas");
    this.firstSubFailCanvas = document.createElement("canvas");
    this.cleanCanvas = document.createElement("canvas");
  }

  start(): void {
    this.stop();
    this.activeElapsedMs = 0;
    this.pausesUsed = 0;
    this.pausedBefore = false;
    this.pendingVerdict = null;
    this.slam = null;
    this.lastFace = null;
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
    this.slam = null;
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
    this.cleanCanvas.width = 0;
    this.cleanCanvas.height = 0;
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

    // Stamp slam: the verdict beat. Holds the frozen evidence frame while the stamp lands.
    if (this.phase === "VERDICT" && this.pendingVerdict && this.slam) {
      const slam = this.slam;
      slam.elapsedMs += dtMs;
      if (!slam.impacted && slam.elapsedMs >= SLAM_APPROACH_MS) {
        slam.impacted = true;
        if (slam.passed) {
          this.callbacks.playPassChime?.();
        } else {
          this.callbacks.playStampThud?.();
        }
      }
      this.drawSlamFrame(ctx, vp);
      if (slam.elapsedMs >= slam.totalMs) {
        const verdict = this.pendingVerdict;
        this.pendingVerdict = null;
        this.slam = null;
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
      ctx.fillStyle = THEME.screen;
      ctx.fillRect(0, 0, vp.width, vp.height);
    }

    // Surveillance treatment: part of the "clean" frame that ends up on the evidence card
    this.drawSurveillance(ctx, vp, this.phase === "ACTIVE");
    if (this.phase === "ACTIVE") {
      this.captureCleanFrame(vp);
    }

    const frame = this.tracker.step(this.video, nowMs, dtMs, rect, this.baseline, true);

    if (frame.signal.tracked) {
      this.lastFace = frame.signal.faceBox;
      const showWire =
        this.phase === "CALIBRATING" || (this.phase === "ACTIVE" && !this.manifest.hideWireframe);
      if (showWire) {
        drawFaceWireframe(ctx, frame.signal.landmarks);
      }
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
                this.firstSubFailCanvas.getContext("2d")?.drawImage(this.cleanCanvas, 0, 0);
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

    // Evidence frame: the clean camera frame (no HUD), annotated with the offending feature.
    this.snapshotCanvas.width = vp.width;
    this.snapshotCanvas.height = vp.height;
    const snapCtx = this.snapshotCanvas.getContext("2d");
    if (snapCtx) {
      const useSubFail = this.hasSubFailSnapshot && this.firstSubFailCanvas.width > 0;
      const source = useSubFail
        ? this.firstSubFailCanvas
        : this.cleanCanvas.width > 0
          ? this.cleanCanvas
          : this.canvas;
      snapCtx.drawImage(source, 0, 0);
      if (!useSubFail && !passed && "evidence" in res && res.evidence) {
        drawEvidenceAnnotation(snapCtx, res.evidence);
      }
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

    const stampText = pickStampText(this.seed, passed);
    const face = this.lastFace;
    const slam: SlamState = {
      passed,
      elapsedMs: 0,
      totalMs: passed ? SLAM_TOTAL_PASS_MS : SLAM_TOTAL_FAIL_MS,
      impacted: false,
      stamp: createStampBitmap(stampText, stampColor(passed), this.seed),
      color: stampColor(passed),
      cx: face && face.w > 0 ? face.x + face.w / 2 : vp.width / 2,
      cy: face && face.h > 0 ? face.y + face.h * 0.34 : vp.height * 0.4,
      width: Math.min(vp.width * 0.7, 440),
      splats: [],
    };
    const rng = mulberry32(this.seed ^ 0x5bd1e995);
    for (let i = 0; i < 16; i++) {
      const angle = rng() * Math.PI * 2;
      const reach = 0.52 + rng() * 0.2;
      slam.splats.push({
        dx: Math.cos(angle) * slam.width * reach,
        dy: Math.sin(angle) * slam.width * reach * 0.42,
        r: 1.5 + rng() * 3,
      });
    }
    this.slam = slam;

    if (this.reducedMotion) {
      // No animation: show the landed stamp and report immediately.
      slam.elapsedMs = SLAM_APPROACH_MS + SLAM_FREEZE_MS + SLAM_SHAKE_MS + 200;
      slam.impacted = true;
      this.drawSlamFrame(ctx, vp);
      if (passed) {
        this.callbacks.playPassChime?.();
      } else {
        this.callbacks.playStampThud?.();
      }
      this.slam = null;
      this.rafId = 0;
      this.callbacks.onVerdict(verdict);
      return;
    }

    this.pendingVerdict = verdict;
    this.drawSlamFrame(ctx, vp);
    this.rafId = requestAnimationFrame(this.tick);
  }

  private captureCleanFrame(vp: Viewport): void {
    if (this.cleanCanvas.width !== vp.width || this.cleanCanvas.height !== vp.height) {
      this.cleanCanvas.width = vp.width;
      this.cleanCanvas.height = vp.height;
    }
    this.cleanCanvas.getContext("2d")?.drawImage(this.canvas, 0, 0);
  }

  /**
   * Treats the feed like office CCTV: desaturated, warm, vignetted, scanlined,
   * with the case number and clock burned in.
   */
  private drawSurveillance(ctx: CanvasRenderingContext2D, vp: Viewport, recording: boolean): void {
    ctx.save();
    ctx.globalCompositeOperation = "saturation";
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.restore();

    if (typeof ctx.createRadialGradient === "function") {
      const cx = vp.width / 2;
      const cy = vp.height / 2;
      const g = ctx.createRadialGradient(
        cx,
        cy,
        Math.min(vp.width, vp.height) * 0.36,
        cx,
        cy,
        Math.max(vp.width, vp.height) * 0.72,
      );
      g.addColorStop(0, "rgba(0, 0, 0, 0)");
      g.addColorStop(1, "rgba(0, 0, 0, 0.5)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, vp.width, vp.height);
    }

    const pattern = this.getScanPattern(ctx);
    if (pattern) {
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, vp.width, vp.height);
    }

    const now = new Date();
    const clock = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, "0"))
      .join(":");
    const label = `${this.options.caseLabel ?? "CASE"} · CAM 04 · ${clock}`;
    ctx.save();
    ctx.font = `600 12px ${FONT_TYPE}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillText(label, 13, 29);
    ctx.fillStyle = THEME.paper;
    ctx.fillText(label, 12, 28);
    if (recording && Math.floor(performance.now() / 600) % 2 === 0) {
      const w = ctx.measureText(label).width;
      ctx.fillStyle = THEME.stampRed;
      ctx.beginPath();
      ctx.arc(12 + w + 12, 28, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private getScanPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (this.scanPattern) return this.scanPattern;
    if (typeof ctx.createPattern !== "function") return null;
    const tile = document.createElement("canvas");
    tile.width = 4;
    tile.height = 4;
    const tctx = tile.getContext("2d");
    if (!tctx) return null;
    tctx.fillStyle = "rgba(0, 0, 0, 0.13)";
    tctx.fillRect(0, 0, 4, 1);
    this.scanPattern = ctx.createPattern(tile, "repeat");
    return this.scanPattern;
  }

  private drawSlamFrame(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const slam = this.slam;
    if (!slam) return;
    const t = slam.elapsedMs;
    const sinceImpact = t - SLAM_APPROACH_MS;

    // Hit-stop first, then a decaying shake (fails only)
    let ox = 0;
    let oy = 0;
    if (!slam.passed && sinceImpact > SLAM_FREEZE_MS && sinceImpact < SLAM_FREEZE_MS + SLAM_SHAKE_MS) {
      const k = 1 - (sinceImpact - SLAM_FREEZE_MS) / SLAM_SHAKE_MS;
      const amp = 9 * k * k;
      ox = (Math.random() - 0.5) * 2 * amp;
      oy = (Math.random() - 0.5) * 2 * amp;
    }

    ctx.save();
    ctx.fillStyle = THEME.screen;
    ctx.fillRect(0, 0, vp.width, vp.height);
    ctx.translate(ox, oy);
    if (this.snapshotCanvas.width > 0) {
      ctx.drawImage(this.snapshotCanvas, 0, 0);
    }
    const dim = Math.min(1, Math.max(0, t / SLAM_APPROACH_MS)) * 0.26;
    ctx.fillStyle = `rgba(20, 19, 15, ${dim.toFixed(3)})`;
    ctx.fillRect(0, 0, vp.width, vp.height);

    if (slam.stamp) {
      if (t < SLAM_APPROACH_MS) {
        const p = Math.max(0, t / SLAM_APPROACH_MS);
        const e = p * p * p;
        blitStamp(ctx, slam.stamp, {
          cx: slam.cx,
          cy: slam.cy,
          width: slam.width * (2.7 - 1.7 * e),
          rotation: -0.1 - (1 - e) * 0.05,
          alpha: 0.3 + 0.6 * e,
        });
      } else {
        const squash = sinceImpact < SLAM_FREEZE_MS ? 1 : Math.max(0, 1 - (sinceImpact - SLAM_FREEZE_MS) / 140);
        blitStamp(ctx, slam.stamp, {
          cx: slam.cx,
          cy: slam.cy,
          width: slam.width,
          rotation: -0.1,
          scaleX: 1 + 0.07 * squash,
          scaleY: 1 - 0.07 * squash,
          alpha: 0.95,
        });
      }
    }

    // Ink splatter around the impression
    if (slam.impacted) {
      ctx.fillStyle = slam.color;
      ctx.globalAlpha = 0.55;
      for (const s of slam.splats) {
        ctx.beginPath();
        ctx.arc(slam.cx + s.dx, slam.cy + s.dy, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // Impact flash
    if (sinceImpact >= 0 && sinceImpact < 70) {
      const peak = slam.passed ? 0.16 : 0.3;
      ctx.fillStyle = `rgba(243, 239, 226, ${(peak * (1 - sinceImpact / 70)).toFixed(3)})`;
      ctx.fillRect(-12, -12, vp.width + 24, vp.height + 24);
    }
    ctx.restore();
  }

  private drawCalibrationOverlay(
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    progress: number,
    tracked: boolean,
  ): void {
    const compact = vp.width < 520;
    ctx.save();

    // Passport-style framing oval
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = tracked ? "rgba(232, 226, 208, 0.85)" : "rgba(179, 38, 30, 0.95)";
    ctx.beginPath();
    ctx.ellipse(vp.width / 2, vp.height * 0.46, vp.width * 0.24, vp.height * 0.32, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const margin = 14;
    const stripH = 72;
    const y = vp.height - stripH - margin;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(margin, y, vp.width - margin * 2, stripH);

    ctx.fillStyle = THEME.ink;
    ctx.font = `600 ${compact ? 16 : 18}px ${FONT_TYPE}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      tracked ? "Hold still. Establishing your neutral." : "Position your face in the oval.",
      margin + 14,
      y + 26,
      vp.width - margin * 2 - 28,
    );

    const barX = margin + 14;
    const barW = vp.width - margin * 2 - 28;
    ctx.fillStyle = "rgba(26, 26, 24, 0.18)";
    ctx.fillRect(barX, y + 50, barW, 6);
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(barX, y + 50, barW * progress, 6);
    ctx.restore();
  }

  private drawPausedOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    ctx.save();
    ctx.fillStyle = "rgba(20, 19, 15, 0.62)";
    ctx.fillRect(0, 0, vp.width, vp.height);

    const w = Math.min(vp.width - 28, 420);
    const h = 84;
    const x = (vp.width - w) / 2;
    const y = (vp.height - h) / 2;
    ctx.fillStyle = THEME.paper;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = THEME.ink;
    ctx.fillRect(x, y + h - 3, w, 3);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${vp.width < 520 ? 17 : 19}px ${FONT_TYPE}`;
    ctx.fillText("Subject lost. Return to frame.", vp.width / 2, y + 30, w - 24);

    ctx.font = `700 14px ${FONT_LABEL}`;
    ctx.fillStyle = THEME.stampRed;
    ctx.fillText(
      `PAUSE ${Math.min(this.pausesUsed, MAX_PAUSES_PER_TRY)} OF ${MAX_PAUSES_PER_TRY}`,
      vp.width / 2,
      y + 58,
    );
    ctx.restore();
  }
}
