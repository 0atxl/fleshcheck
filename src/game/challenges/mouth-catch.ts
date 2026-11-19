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
import { clampEvidenceRect, drawProgressLine, drawTimerTag } from "./hud";

const MOUTH_OPEN_THRESHOLD = 0.16;

interface FallingDoc {
  id: number;
  kind: "form" | "stamp";
  label: string;
  x: number;
  y: number;
  vy: number;
  w: number;
  h: number;
  resolved: boolean;
}

/**
 * Intake challenge: open mouth to swallow falling forms while keeping shut as stamps fall.
 */
export class MouthCatchChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private calloutPool: readonly string[] = ["ILLEGAL STAMP INGESTED"];
  private seed = 1;

  private targetForms = 4;
  private caught = 0;
  private catchFlashMs = 0;
  private mouthPos: Point2D = { x: 320, y: 300 };
  private mouthOpen = false;
  private catchRadius = 44;
  private docs: FallingDoc[] = [];
  private nextSpawnMs = 350;
  private spawnIndex = 0;
  private formNames: string[] = ["Form 27-B"];
  private viewport: Viewport = { width: 640, height: 480 };

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.seed = ctx.seed;
    this.caught = 0;
    this.catchFlashMs = 0;
    this.docs = [];
    this.spawnIndex = 0;
    const isShortRound = this.durationMs <= 5_000;
    this.nextSpawnMs = isShortRound ? 150 : 250;
    this.viewport = { ...ctx.viewport };
    this.mouthPos = { x: ctx.baseline.nose.x, y: ctx.baseline.nose.y + 50 };
    this.mouthOpen = false;
    this.catchRadius = Math.max(38, Math.min(ctx.viewport.width, ctx.viewport.height) * 0.085);

    this.targetForms = isShortRound ? 2 : 4;

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    const rng = mulberry32(ctx.seed);
    const srcForms = ctx.copy.forms ?? ["Form 27-B"];
    this.formNames = shuffleWithRng(srcForms, rng);
  }

  getActiveDocs(): readonly { kind: "form" | "stamp"; x: number; y: number }[] {
    return this.docs.filter((d) => !d.resolved).map((d) => ({ kind: d.kind, x: d.x, y: d.y }));
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    const dtSec = clampedDt / 1000;
    this.elapsedMs += clampedDt;
    if (this.catchFlashMs > 0) {
      this.catchFlashMs = Math.max(0, this.catchFlashMs - clampedDt);
    }
    this.mouthPos = { ...signal.mouth };
    this.mouthOpen = (signal.delta.jawOpen ?? 0) > MOUTH_OPEN_THRESHOLD;

    // Deterministic scheduled spawns aligned horizontally near user's mouth lane
    const isShortRound = this.durationMs <= 5_000;
    const spawnCutoffMs = isShortRound ? this.durationMs - 650 : this.durationMs - 800;
    while (this.elapsedMs >= this.nextSpawnMs && this.elapsedMs < spawnCutoffMs) {
      const rng = mulberry32(this.seed + this.spawnIndex * 97);
      const isStamp = this.spawnIndex % 3 === 1;
      const laneJitter = (rng() - 0.5) * this.viewport.width * 0.34;
      const x = Math.max(60, Math.min(this.viewport.width - 60, this.mouthPos.x + laneJitter));
      const baseVy = isShortRound ? this.viewport.height * 0.45 : this.viewport.height * 0.36;
      const vy = baseVy + rng() * 50;

      this.docs.push({
        id: this.spawnIndex,
        kind: isStamp ? "stamp" : "form",
        label: isStamp ? "REJECT" : this.formNames[this.spawnIndex % this.formNames.length]!,
        x,
        y: 44,
        vy,
        w: isStamp ? 88 : 96,
        h: 42,
        resolved: false,
      });

      this.spawnIndex += 1;
      const cadence = isShortRound ? 600 : 1_150;
      this.nextSpawnMs += cadence;
    }

    for (const doc of this.docs) {
      if (doc.resolved) continue;
      doc.y += doc.vy * dtSec;

      const hit =
        Math.abs(this.mouthPos.x - doc.x) <= doc.w / 2 + this.catchRadius * 0.55 &&
        Math.abs(this.mouthPos.y - doc.y) <= doc.h / 2 + this.catchRadius * 0.55;

      if (hit && this.mouthOpen) {
        doc.resolved = true;
        if (doc.kind === "stamp") {
          this.status = "failed";
          const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
          const stampCalls = this.calloutPool.filter((c) => !c.includes("QUOTA") && !c.includes("INSUFFICIENT"));
          const pool = stampCalls.length > 0 ? stampCalls : this.calloutPool;
          this.callout = pool[Math.floor(rng() * pool.length)] ?? "ILLEGAL STAMP INGESTED";
          this.evidence = this.buildMouthEvidence(`Caught ${doc.label.toLowerCase()} stamp`);
          return;
        }
        this.caught += 1;
        this.catchFlashMs = 220;
        if (this.caught >= this.targetForms) {
          this.status = "passed";
          return;
        }
      }
    }

    this.docs = this.docs.filter((d) => !d.resolved && d.y < this.viewport.height + 60);

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "failed";
      this.callout = "INSUFFICIENT ORAL INTAKE";
      this.evidence = this.buildMouthEvidence(`Forms ${this.caught} / required ${this.targetForms}`);
    }
  }

  private buildMouthEvidence(label: string): EvidenceMark {
    const r = this.catchRadius;
    return {
      rect: clampEvidenceRect(
        { x: this.mouthPos.x - r, y: this.mouthPos.y - r * 0.8, w: r * 2, h: r * 1.6 },
        this.viewport,
        72,
        56,
      ),
      label,
    };
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);

    ctx.save();

    // Mouth intake ring
    const ringRadius = this.catchRadius * (this.mouthOpen ? 1.05 : 0.72);
    ctx.strokeStyle = this.mouthOpen ? THEME.stampBlue : THEME.paper;
    ctx.lineWidth = this.mouthOpen ? 3.5 : 2;
    ctx.beginPath();
    ctx.arc(this.mouthPos.x, this.mouthPos.y, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    const mouthLabel = this.mouthOpen ? "INTAKE OPEN" : "SHUT";
    ctx.font = `700 11px ${FONT_LABEL}`;
    const chipW = ctx.measureText(mouthLabel).width + 12;
    const chipY = this.mouthPos.y + this.catchRadius + 6;
    ctx.fillStyle = this.mouthOpen ? THEME.stampBlue : "rgba(20, 19, 15, 0.75)";
    ctx.fillRect(this.mouthPos.x - chipW / 2, chipY, chipW, 18);
    ctx.fillStyle = THEME.paperLight;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(mouthLabel, this.mouthPos.x, chipY + 10);

    // Falling forms & stamps
    for (const doc of this.docs) {
      const x0 = doc.x - doc.w / 2;
      const y0 = doc.y - doc.h / 2;
      if (doc.kind === "stamp") {
        ctx.fillStyle = THEME.stampRed;
        ctx.fillRect(x0, y0, doc.w, doc.h);
        ctx.strokeStyle = THEME.paperLight;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 3, y0 + 3, doc.w - 6, doc.h - 6);
        ctx.fillStyle = THEME.paperLight;
        ctx.font = `700 15px ${FONT_LABEL}`;
        ctx.fillText(doc.label, doc.x, doc.y + 1);
      } else {
        ctx.fillStyle = THEME.paperLight;
        ctx.fillRect(x0, y0, doc.w, doc.h);
        ctx.fillStyle = THEME.formBlue;
        ctx.fillRect(x0, y0, doc.w, 5);
        ctx.strokeStyle = THEME.ink;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, y0, doc.w, doc.h);
        ctx.fillStyle = THEME.ink;
        ctx.font = `700 11px ${FONT_TYPE}`;
        ctx.fillText(doc.label, doc.x, doc.y + 3, doc.w - 8);
      }
    }

    // Unified HUD
    drawProgressLine(ctx, vp, progress, {
      danger: this.status === "failed",
      accent: this.catchFlashMs > 0 ? THEME.stampBlue : THEME.paper,
    });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs), {
      counter: `${this.caught}/${this.targetForms}`,
    });

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress =
      this.status === "passed" ? 1 : Math.min(0.99, this.caught / Math.max(1, this.targetForms));
    return {
      status: this.status,
      progress,
      milestones: this.caught,
      ...(this.callout !== undefined ? { callout: this.callout } : {}),
      ...(this.evidence !== undefined ? { evidence: this.evidence } : {}),
    };
  }
}
