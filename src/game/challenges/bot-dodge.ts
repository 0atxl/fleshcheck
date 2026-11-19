import { mulberry32 } from "../prng";
import { FONT_LABEL, THEME } from "../theme";
import type {
  Challenge,
  ChallengeContext,
  ChallengeResult,
  EvidenceMark,
  FaceSignal,
  Rect2D,
  Viewport,
} from "../types";
import { clampEvidenceRect, drawProgressLine, drawPromptStrip, drawTimerTag } from "./hud";

export const BOT_OVERLAP_FAIL_RATIO = 0.35;
const ENTRY_GRACE_MS = 700;

interface StampMover {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
}

/**
 * Returns how much of the stamp (or face box when smaller) is covered by overlap [0..1].
 */
export function computeStampOverlapRatio(stamp: Rect2D, faceBox: Rect2D): number {
  if (stamp.w <= 0 || stamp.h <= 0 || faceBox.w <= 0 || faceBox.h <= 0) return 0;

  const ix = Math.max(stamp.x, faceBox.x);
  const iy = Math.max(stamp.y, faceBox.y);
  const ax = Math.min(stamp.x + stamp.w, faceBox.x + faceBox.w);
  const ay = Math.min(stamp.y + stamp.h, faceBox.y + faceBox.h);

  const iw = Math.max(0, ax - ix);
  const ih = Math.max(0, ay - iy);
  const interArea = iw * ih;
  if (interArea <= 0) return 0;

  const stampArea = stamp.w * stamp.h;
  const faceArea = faceBox.w * faceBox.h;
  return interArea / Math.min(stampArea, faceArea);
}

/**
 * Designations challenge: dodge the bouncing BOT? stamp with your head.
 */
export class BotDodgeChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private calloutPool: readonly string[] = ["DESIGNATION APPLIED"];
  private seed = 1;

  private stamp: StampMover = { x: 24, y: 64, w: 120, h: 60, vx: 220, vy: 180 };
  private decoy: StampMover | null = null;
  private viewport: Viewport = { width: 640, height: 480 };
  private faceBox: Rect2D = { x: 0, y: 0, w: 0, h: 0 };
  private tooClose = false;
  private slowdownActive = false;
  private slowdownTriggered = false;
  private trail: { x: number; y: number }[] = [];

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.seed = ctx.seed;
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.slowdownActive = false;
    this.slowdownTriggered = false;
    this.trail = [];
    this.tooClose = false;
    this.viewport = { ...ctx.viewport };

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    const rng = mulberry32(ctx.seed);
    const minDim = Math.min(ctx.viewport.width, ctx.viewport.height);
    const stampW = Math.round(minDim * 0.28);
    const stampH = Math.round(minDim * 0.14);

    // Spawn in corner opposite calibrated nose
    const spawnRight = ctx.baseline.nose.x < ctx.viewport.width / 2;
    const spawnBottom = ctx.baseline.nose.y < ctx.viewport.height / 2;
    const x = spawnRight ? ctx.viewport.width - stampW - 20 : 20;
    const y = spawnBottom ? ctx.viewport.height - stampH - 20 : 56;

    const baseSpeed = minDim * 0.56;
    const angle = (0.38 + rng() * 0.45) * (Math.PI / 2);
    const vx = (spawnRight ? -1 : 1) * Math.cos(angle) * baseSpeed;
    const vy = (spawnBottom ? -1 : 1) * Math.sin(angle) * baseSpeed;

    this.stamp = { x, y, w: stampW, h: stampH, vx, vy };
    this.decoy = {
      x: spawnRight ? 24 : ctx.viewport.width - stampW - 24,
      y: 64,
      w: Math.round(stampW * 0.85),
      h: Math.round(stampH * 0.85),
      vx: -vx * 0.72,
      vy: vy * 0.85,
    };
  }

  getStampRect(): Rect2D {
    return { x: this.stamp.x, y: this.stamp.y, w: this.stamp.w, h: this.stamp.h };
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    const dtSec = clampedDt / 1000;
    this.elapsedMs += clampedDt;
    this.faceBox = signal.faceBox;
    this.tooClose =
      this.faceBox.w > this.viewport.width * 0.72 ||
      this.faceBox.h > this.viewport.height * 0.78;

    const progress = this.elapsedMs / this.durationMs;

    // Seeded fake slowdown between 42% and 50%, followed by acceleration
    const inSlowWindow = progress >= 0.42 && progress <= 0.50;
    if (inSlowWindow) {
      this.slowdownActive = true;
    } else {
      if (this.slowdownActive && !this.slowdownTriggered) {
        this.slowdownTriggered = true;
        this.stamp.vx *= 1.24;
        this.stamp.vy *= 1.24;
      }
      this.slowdownActive = false;
    }

    const speedFactor = this.slowdownActive ? 0.34 : 1;

    if (this.elapsedMs >= ENTRY_GRACE_MS) {
      this.stepMover(this.stamp, dtSec * speedFactor);
      this.trail.push({ x: this.stamp.x + this.stamp.w / 2, y: this.stamp.y + this.stamp.h / 2 });
      if (this.trail.length > 10) this.trail.shift();
    }

    if (this.decoy && progress >= 0.35) {
      this.stepMover(this.decoy, dtSec);
    }

    if (this.elapsedMs >= ENTRY_GRACE_MS) {
      const overlap = computeStampOverlapRatio(this.stamp, signal.faceBox);
      if (overlap > BOT_OVERLAP_FAIL_RATIO) {
        this.status = "failed";
        const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
        this.callout =
          this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "DESIGNATION APPLIED";
        this.evidence = this.buildOverlapEvidence(overlap, signal.faceBox);
        return;
      }
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "passed";
    }
  }

  private buildOverlapEvidence(overlap: number, faceBox: Rect2D): EvidenceMark {
    const ix = Math.max(this.stamp.x, faceBox.x);
    const iy = Math.max(this.stamp.y, faceBox.y);
    const ax = Math.min(this.stamp.x + this.stamp.w, faceBox.x + faceBox.w);
    const ay = Math.min(this.stamp.y + this.stamp.h, faceBox.y + faceBox.h);
    const rawRect: Rect2D =
      ax > ix && ay > iy
        ? { x: ix, y: iy, w: ax - ix, h: ay - iy }
        : { x: this.stamp.x, y: this.stamp.y, w: this.stamp.w, h: this.stamp.h };
    const pct = Math.round(overlap * 100);
    const limitPct = Math.round(BOT_OVERLAP_FAIL_RATIO * 100);
    return {
      rect: clampEvidenceRect(rawRect, this.viewport, 60, 44),
      label: `Overlap ${pct}% / limit ${limitPct}%`,
    };
  }

  private stepMover(mover: StampMover, dtSec: number): void {
    mover.x += mover.vx * dtSec;
    mover.y += mover.vy * dtSec;
    this.clampToViewport(mover, this.viewport);
  }

  /**
   * Keeps bouncing stamps inside the active viewport bounds.
   */
  private clampToViewport(mover: StampMover, vp: Viewport): void {
    const minY = 48;
    const maxX = Math.max(0, vp.width - mover.w - 4);
    const maxY = Math.max(minY, vp.height - mover.h - 4);

    if (mover.x <= 4) {
      mover.x = 4;
      mover.vx = Math.abs(mover.vx);
    } else if (mover.x >= maxX) {
      mover.x = maxX;
      mover.vx = -Math.abs(mover.vx);
    }

    if (mover.y <= minY) {
      mover.y = minY;
      mover.vy = Math.abs(mover.vy);
    } else if (mover.y >= maxY) {
      mover.y = maxY;
      mover.vy = -Math.abs(mover.vy);
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);

    ctx.save();

    // Subject face bounding box corners
    if (this.faceBox.w > 0 && this.faceBox.h > 0) {
      const { x, y, w, h } = this.faceBox;
      ctx.strokeStyle = this.status === "failed" ? THEME.stampRed : THEME.paper;
      ctx.globalAlpha = this.status === "failed" ? 1 : 0.8;
      ctx.lineWidth = 2.5;
      const corner = 16;
      drawCornerBracket(ctx, x, y, corner, 1, 1);
      drawCornerBracket(ctx, x + w, y, corner, -1, 1);
      drawCornerBracket(ctx, x, y + h, corner, 1, -1);
      drawCornerBracket(ctx, x + w, y + h, corner, -1, -1);
      ctx.globalAlpha = 1;
    }

    // Ink trail
    ctx.fillStyle = THEME.stampRed;
    for (let i = 0; i < this.trail.length; i++) {
      const pt = this.trail[i]!;
      ctx.globalAlpha = ((i + 1) / this.trail.length) * 0.28;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Decoy ghost stamp
    if (this.decoy && progress >= 0.35) {
      ctx.save();
      ctx.fillStyle = "rgba(20, 19, 15, 0.52)";
      ctx.fillRect(this.decoy.x, this.decoy.y, this.decoy.w, this.decoy.h);
      ctx.strokeStyle = THEME.paper;
      ctx.globalAlpha = 0.65;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(this.decoy.x, this.decoy.y, this.decoy.w, this.decoy.h);
      ctx.setLineDash([]);
      ctx.fillStyle = THEME.paper;
      ctx.font = `700 15px ${FONT_LABEL}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("MAYBE?", this.decoy.x + this.decoy.w / 2, this.decoy.y + this.decoy.h / 2 + 1);
      ctx.restore();
    }

    // Main BOT? rubber stamp
    const armed = this.elapsedMs >= ENTRY_GRACE_MS;
    ctx.save();
    ctx.globalAlpha = armed ? 0.94 : 0.65;
    ctx.fillStyle = armed ? THEME.stampRed : THEME.formBlue;
    ctx.fillRect(this.stamp.x, this.stamp.y, this.stamp.w, this.stamp.h);
    ctx.strokeStyle = THEME.paperLight;
    ctx.lineWidth = 3;
    ctx.strokeRect(this.stamp.x + 4, this.stamp.y + 4, this.stamp.w - 8, this.stamp.h - 8);

    ctx.fillStyle = THEME.paperLight;
    ctx.font = `700 ${Math.round(this.stamp.h * 0.56)}px ${FONT_LABEL}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("BOT?", this.stamp.x + this.stamp.w / 2, this.stamp.y + this.stamp.h / 2 + 2);
    ctx.restore();

    if (this.slowdownActive) {
      const placeBelow = this.stamp.y < 70;
      const labelY = placeBelow ? this.stamp.y + this.stamp.h + 4 : this.stamp.y - 24;
      ctx.fillStyle = THEME.paper;
      ctx.fillRect(this.stamp.x, labelY, this.stamp.w, 20);
      ctx.fillStyle = THEME.stampRed;
      ctx.font = `700 11px ${FONT_LABEL}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("RECALCULATING", this.stamp.x + this.stamp.w / 2, labelY + 11);
    }

    // Unified HUD
    drawProgressLine(ctx, vp, progress, { danger: this.status === "failed" });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs));

    if (this.tooClose) {
      drawPromptStrip(ctx, vp, "Subject too close. Step back from the lens.", {
        label: "DISTANCE NOTICE",
        labelColor: THEME.stampRed,
        borderAccent: THEME.stampRed,
        maxLines: 2,
      });
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

function drawCornerBracket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  sx: number,
  sy: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + sx * len, y);
  ctx.lineTo(x, y);
  ctx.lineTo(x, y + sy * len);
  ctx.stroke();
}
