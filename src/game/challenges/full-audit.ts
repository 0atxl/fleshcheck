import { mulberry32, shuffleWithRng } from "../prng";
import { computeHumanPct } from "../scoring";
import type {
  Challenge,
  ChallengeContext,
  ChallengeManifest,
  ChallengeResult,
  FaceSignal,
  TryRecord,
  Viewport,
} from "../types";

const INTERMISSION_MS = 450;

/**
 * Annual Audit challenge: chains three 4-second mini-rounds from distinct face
 * challenges with a single daily attempt and per-round emoji squares.
 */
export class FullAuditChallenge implements Challenge<FaceSignal> {
  private subManifests: ChallengeManifest[] = [];
  private activeChallenge: Challenge | null = null;
  private roundIndex = 0;
  private roundDurationMs = 4_000;
  private roundRecords: TryRecord[] = [];
  private roundProgresses: number[] = [];
  private intermissionMs = 0;
  private lastRoundNote = "";
  private lastRoundPassed = false;
  private transitions: string[] = [];
  private calloutPool: readonly string[] = ["ANNUAL AUDIT FAILED"];
  private firstFailCallout: string | undefined;
  private status: ChallengeResult["status"] = "running";
  private baseCtx!: ChallengeContext;

  constructor(private readonly getCandidates: () => readonly ChallengeManifest[]) {}

  init(ctx: ChallengeContext): void {
    this.baseCtx = ctx;
    this.roundIndex = 0;
    this.roundRecords = [];
    this.roundProgresses = [];
    this.intermissionMs = 0;
    this.lastRoundNote = "";
    this.lastRoundPassed = false;
    this.firstFailCallout = undefined;
    this.status = "running";

    const eligible = this.getCandidates().filter(
      (c) => c.enabled && c.model === "face" && c.id !== "FULL_AUDIT",
    );
    const rng = mulberry32(ctx.seed);
    this.subManifests = shuffleWithRng(eligible, rng).slice(0, 3);
    this.roundDurationMs = Math.max(1_000, Math.floor(ctx.durationMs / Math.max(1, this.subManifests.length)));

    const srcTransitions = ctx.copy.transitions ?? ["Forwarding dossier to next desk."];
    this.transitions = shuffleWithRng(srcTransitions, rng);
    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    this.startRound(0);
  }

  getSubManifests(): readonly ChallengeManifest[] {
    return this.subManifests;
  }

  private startRound(index: number): void {
    const manifest = this.subManifests[index];
    if (!manifest) {
      this.finalizeAudit();
      return;
    }
    const ch = manifest.create();
    ch.init({
      seed: (this.baseCtx.seed + (index + 1) * 7919) >>> 0,
      baseline: this.baseCtx.baseline,
      copy: manifest.copy,
      viewport: this.baseCtx.viewport,
      durationMs: this.roundDurationMs,
    });
    this.activeChallenge = ch;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));

    if (this.intermissionMs > 0) {
      this.intermissionMs = Math.max(0, this.intermissionMs - clampedDt);
      if (this.intermissionMs === 0) {
        this.roundIndex += 1;
        this.startRound(this.roundIndex);
      }
      return;
    }

    if (!this.activeChallenge) {
      this.finalizeAudit();
      return;
    }

    this.activeChallenge.update(clampedDt, signal);
    const subRes = this.activeChallenge.getResult();

    if (subRes.status === "passed" || subRes.status === "failed") {
      const passed = subRes.status === "passed";
      this.roundRecords.push({
        passed,
        pct: computeHumanPct(subRes.progress, subRes.status),
        paused: false,
      });
      this.roundProgresses.push(passed ? 1 : subRes.progress);

      if (!passed && !this.firstFailCallout) {
        this.firstFailCallout = subRes.callout ?? "STATION REJECTED";
      }

      if (this.roundIndex < this.subManifests.length - 1) {
        this.lastRoundPassed = passed;
        this.lastRoundNote =
          this.transitions[this.roundIndex % this.transitions.length] ??
          "Forwarding dossier to next desk.";
        this.intermissionMs = INTERMISSION_MS;
      } else {
        this.finalizeAudit();
      }
    }
  }

  private finalizeAudit(): void {
    const allPassed =
      this.roundRecords.length === this.subManifests.length &&
      this.roundRecords.every((r) => r.passed);
    this.status = allPassed ? "passed" : "failed";
    if (!allPassed && !this.firstFailCallout) {
      this.firstFailCallout = this.calloutPool[0] ?? "ANNUAL AUDIT FAILED";
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const currentManifest = this.subManifests[this.roundIndex];

    if (this.intermissionMs > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(26, 29, 30, 0.84)";
      ctx.fillRect(0, 0, vp.width, vp.height);

      ctx.fillStyle = this.lastRoundPassed ? "#51CF66" : "#FF6B6B";
      ctx.font = "800 18px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `STATION ${this.roundIndex + 1} OF ${this.subManifests.length}: ${this.lastRoundPassed ? "CLEARED" : "REJECTED"}`,
        vp.width / 2,
        vp.height / 2 - 14,
      );

      ctx.fillStyle = "#F6F7F4";
      ctx.font = "500 14px system-ui, -apple-system, sans-serif";
      ctx.fillText(this.lastRoundNote, vp.width / 2, vp.height / 2 + 16);
      ctx.restore();
      return;
    }

    if (this.activeChallenge) {
      this.activeChallenge.draw(ctx, vp);
    }

    // Sub-round audit strip beneath top bar
    ctx.save();
    ctx.fillStyle = "rgba(26, 29, 30, 0.85)";
    ctx.fillRect(vp.width - 210, 48, 194, 24);
    ctx.fillStyle = "#E8590C";
    ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const stationTitle = currentManifest ? currentManifest.title.toUpperCase() : "AUDIT";
    ctx.fillText(
      `AUDIT ${Math.min(this.roundIndex + 1, 3)}/3 · ${stationTitle}`,
      vp.width - 22,
      60,
    );
    ctx.restore();
  }

  getResult(): ChallengeResult {
    const count = Math.max(1, this.subManifests.length);
    let progressSum = this.roundProgresses.reduce((acc, v) => acc + v, 0);
    if (this.status === "running" && this.activeChallenge && this.intermissionMs === 0) {
      progressSum += this.activeChallenge.getResult().progress;
    }
    const progress =
      this.status === "passed" ? 1 : Math.min(0.99, progressSum / count);

    const res: ChallengeResult = {
      status: this.status,
      progress,
      roundRecords: [...this.roundRecords],
    };
    if (this.status === "failed" && this.firstFailCallout) {
      res.callout = this.firstFailCallout;
    }
    return res;
  }
}
