import { mulberry32, shuffleWithRng } from "../prng";
import type { Challenge, ChallengeContext, ChallengeResult, FaceSignal, Point2D, Viewport } from "../types";

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
  private calloutPool: readonly string[] = ["ILLEGAL STAMP INGESTED"];
  private seed = 1;

  private targetForms = 4;
  private caught = 0;
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
    this.seed = ctx.seed;
    this.caught = 0;
    this.docs = [];
    this.spawnIndex = 0;
    this.nextSpawnMs = 250;
    this.viewport = { ...ctx.viewport };
    this.mouthPos = { x: ctx.baseline.nose.x, y: ctx.baseline.nose.y + 50 };
    this.mouthOpen = false;
    this.catchRadius = Math.max(38, Math.min(ctx.viewport.width, ctx.viewport.height) * 0.085);

    this.targetForms = this.durationMs <= 5_000 ? 2 : 4;

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    const rng = mulberry32(ctx.seed);
    const srcForms = ctx.copy.forms ?? ["Form 27-B"];
    this.formNames = shuffleWithRng(srcForms, rng);
  }

  spawnForTest(kind: "form" | "stamp", x: number, y: number): void {
    this.docs.push({
      id: ++this.spawnIndex,
      kind,
      label: kind === "form" ? "Form 27-B" : "BOT?",
      x,
      y,
      vy: 140,
      w: 84,
      h: 42,
      resolved: false,
    });
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    const dtSec = clampedDt / 1000;
    this.elapsedMs += clampedDt;
    this.mouthPos = { ...signal.mouth };
    this.mouthOpen = (signal.delta.jawOpen ?? 0) > MOUTH_OPEN_THRESHOLD;

    // Deterministic scheduled spawns aligned horizontally near user's mouth lane
    while (this.elapsedMs >= this.nextSpawnMs && this.elapsedMs < this.durationMs - 800) {
      const rng = mulberry32(this.seed + this.spawnIndex * 97);
      const isStamp = this.spawnIndex % 3 === 1;
      const laneJitter = (rng() - 0.5) * this.viewport.width * 0.34;
      const x = Math.max(60, Math.min(this.viewport.width - 60, this.mouthPos.x + laneJitter));
      const vy = (this.viewport.height * 0.36) + rng() * 50;

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
      const cadence = this.durationMs <= 5_000 ? 750 : 1_150;
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
          return;
        }
        this.caught += 1;
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
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);

    ctx.save();

    // Mouth intake ring
    ctx.strokeStyle = this.mouthOpen ? "#2B8A3E" : "rgba(246, 247, 244, 0.7)";
    ctx.lineWidth = this.mouthOpen ? 3.5 : 2;
    ctx.beginPath();
    ctx.arc(this.mouthPos.x, this.mouthPos.y, this.catchRadius * (this.mouthOpen ? 1.05 : 0.72), 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = this.mouthOpen ? "#51CF66" : "#F6F7F4";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.mouthOpen ? "INTAKE OPEN" : "SHUT", this.mouthPos.x, this.mouthPos.y + this.catchRadius + 12);

    // Falling forms & stamps
    for (const doc of this.docs) {
      const x0 = doc.x - doc.w / 2;
      const y0 = doc.y - doc.h / 2;
      if (doc.kind === "stamp") {
        ctx.fillStyle = "rgba(201, 42, 42, 0.92)";
        ctx.fillRect(x0, y0, doc.w, doc.h);
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 3, y0 + 3, doc.w - 6, doc.h - 6);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "800 13px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(doc.label, doc.x, doc.y);
      } else {
        ctx.fillStyle = "#F6F7F4";
        ctx.fillRect(x0, y0, doc.w, doc.h);
        ctx.strokeStyle = "#1A1D1E";
        ctx.lineWidth = 2;
        ctx.strokeRect(x0, y0, doc.w, doc.h);
        ctx.fillStyle = "#1A1D1E";
        ctx.font = "700 12px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.fillText(doc.label, doc.x, doc.y);
      }
    }

    // Header HUD
    ctx.fillStyle = "rgba(26, 29, 30, 0.72)";
    ctx.fillRect(0, 0, vp.width, 44);
    ctx.fillStyle = this.status === "failed" ? "#C92A2A" : "#E8590C";
    ctx.fillRect(0, 40, vp.width * progress, 4);

    ctx.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#F6F7F4";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(`FORM 07-I · INTAKE (${this.caught}/${this.targetForms})`, 16, 20);

    const remaining = Math.max(0, (this.durationMs - this.elapsedMs) / 1000).toFixed(1);
    ctx.textAlign = "right";
    ctx.fillText(`${remaining}s`, vp.width - 16, 20);

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress =
      this.status === "passed" ? 1 : Math.min(0.99, this.caught / Math.max(1, this.targetForms));
    if (this.callout !== undefined) {
      return { status: this.status, progress, callout: this.callout };
    }
    return { status: this.status, progress };
  }
}
