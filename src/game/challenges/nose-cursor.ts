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

const TARGET_DWELL_MS = 550;
const TRAP_DWELL_MS = 320;
const ENTRY_GRACE_MS = 650;

interface CheckboxNode {
  x: number;
  y: number;
  label: string;
  trap: boolean;
  orderIndex: number; // 0..N-1 for good boxes, -1 for traps
  checked: boolean;
  dwellMs: number;
}

/**
 * Input Devices challenge: tick numbered checkboxes in order using your nose tip
 * while avoiding trap clauses.
 */
export class NoseCursorChallenge implements Challenge<FaceSignal> {
  private elapsedMs = 0;
  private durationMs = 12_000;
  private status: ChallengeResult["status"] = "running";
  private callout: string | undefined;
  private evidence: EvidenceMark | undefined;
  private calloutPool: readonly string[] = ["TRAP CONSENT FILED"];
  private seed = 1;

  private boxes: CheckboxNode[] = [];
  private cursor: Point2D = { x: 320, y: 240 };
  private viewport: Viewport = { width: 640, height: 480 };
  private nextOrder = 0;
  private tickFlashMs = 0;
  private targetCount = 3;
  private hitRadius = 42;

  init(ctx: ChallengeContext): void {
    this.elapsedMs = 0;
    this.durationMs = Math.max(1_000, ctx.durationMs);
    this.status = "running";
    this.callout = undefined;
    this.evidence = undefined;
    this.seed = ctx.seed;
    this.nextOrder = 0;
    this.tickFlashMs = 0;
    this.cursor = { ...ctx.baseline.nose };
    this.viewport = { ...ctx.viewport };

    if (ctx.copy.callouts.length > 0) {
      this.calloutPool = ctx.copy.callouts;
    }

    const rng = mulberry32(ctx.seed);
    const items = ctx.copy.checkboxes ?? [];
    const goodPool = shuffleWithRng(items.filter((i) => !i.trap), rng);
    const trapPool = shuffleWithRng(items.filter((i) => i.trap), rng);

    this.targetCount = this.durationMs <= 5_000 ? 2 : 3;
    const trapCount = this.durationMs <= 5_000 ? 1 : 2;
    this.hitRadius = Math.max(36, Math.min(ctx.viewport.width, ctx.viewport.height) * 0.085);

    const w = ctx.viewport.width;
    const h = ctx.viewport.height;
    const candidateSlots: Point2D[] = shuffleWithRng(
      [
        { x: w * 0.28, y: h * 0.28 },
        { x: w * 0.72, y: h * 0.28 },
        { x: w * 0.5, y: h * 0.48 },
        { x: w * 0.28, y: h * 0.68 },
        { x: w * 0.72, y: h * 0.68 },
      ],
      rng,
    );

    // Never place a trap checkbox on or immediately adjacent to the calibrated resting nose
    const safeTrapRadius = this.hitRadius * 1.6;
    const trapSafeSlots = candidateSlots.filter(
      (s) => Math.hypot(s.x - ctx.baseline.nose.x, s.y - ctx.baseline.nose.y) > safeTrapRadius,
    );
    const trapChosenSlots = trapSafeSlots.slice(0, trapCount);
    const trapSet = new Set(trapChosenSlots);
    const targetSlots = candidateSlots.filter((s) => !trapSet.has(s)).slice(0, this.targetCount);

    const nodes: CheckboxNode[] = [];
    for (let i = 0; i < targetSlots.length; i++) {
      const slot = targetSlots[i]!;
      nodes.push({
        x: slot.x,
        y: slot.y,
        label: goodPool[i]?.label ?? `Confirm box ${i + 1}`,
        trap: false,
        orderIndex: i,
        checked: false,
        dwellMs: 0,
      });
    }
    for (let j = 0; j < trapChosenSlots.length; j++) {
      const slot = trapChosenSlots[j]!;
      nodes.push({
        x: slot.x,
        y: slot.y,
        label: trapPool[j]?.label ?? "I agree to be replaced",
        trap: true,
        orderIndex: -1,
        checked: false,
        dwellMs: 0,
      });
    }

    this.boxes = nodes;
  }

  getActiveTarget(): Point2D | null {
    const active = this.boxes.find((b) => !b.trap && b.orderIndex === this.nextOrder);
    return active ? { x: active.x, y: active.y } : null;
  }

  getTrapTarget(): Point2D | null {
    const trap = this.boxes.find((b) => b.trap);
    return trap ? { x: trap.x, y: trap.y } : null;
  }

  update(dtMs: number, signal: FaceSignal): void {
    if (this.status !== "running" || !signal.tracked) return;

    const clampedDt = Math.min(80, Math.max(1, dtMs));
    this.elapsedMs += clampedDt;
    if (this.tickFlashMs > 0) {
      this.tickFlashMs = Math.max(0, this.tickFlashMs - clampedDt);
    }
    this.cursor = { ...signal.nose };

    for (const box of this.boxes) {
      if (box.checked) continue;

      const dist = Math.hypot(this.cursor.x - box.x, this.cursor.y - box.y);
      const isHovering = dist <= this.hitRadius;

      if (box.trap) {
        if (this.elapsedMs < ENTRY_GRACE_MS) continue;
        if (isHovering) {
          box.dwellMs += clampedDt;
          if (box.dwellMs >= TRAP_DWELL_MS) {
            box.checked = true;
            this.status = "failed";
            const rng = mulberry32(this.seed ^ Math.round(this.elapsedMs));
            this.callout =
              this.calloutPool[Math.floor(rng() * this.calloutPool.length)] ?? "TRAP CONSENT FILED";
            this.evidence = {
              rect: clampEvidenceRect(
                { x: box.x - 42, y: box.y - 26, w: 84, h: 72 },
                this.viewport,
                72,
                60,
              ),
              label: `Trap: ${box.label}`,
            };
            return;
          }
        } else {
          box.dwellMs = Math.max(0, box.dwellMs - clampedDt * 2);
        }
      } else if (box.orderIndex === this.nextOrder) {
        if (isHovering) {
          box.dwellMs += clampedDt;
          if (box.dwellMs >= TARGET_DWELL_MS) {
            box.checked = true;
            this.nextOrder += 1;
            this.tickFlashMs = 220;
            if (this.nextOrder >= this.targetCount) {
              this.status = "passed";
              return;
            }
          }
        } else {
          box.dwellMs = Math.max(0, box.dwellMs - clampedDt * 1.5);
        }
      }
    }

    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.status = "failed";
      this.callout = "INPUT DEVICE TIMEOUT";
      const missing = this.boxes.find((b) => !b.trap && b.orderIndex === this.nextOrder);
      const cx = missing ? missing.x : this.cursor.x;
      const cy = missing ? missing.y : this.cursor.y;
      this.evidence = {
        rect: clampEvidenceRect({ x: cx - 42, y: cy - 26, w: 84, h: 72 }, this.viewport, 72, 60),
        label: `Ticked ${this.nextOrder} / required ${this.targetCount}`,
      };
    }
  }

  draw(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.viewport = { ...vp };
    const progress = Math.min(1, this.elapsedMs / this.durationMs);
    ctx.save();

    // Draw form checkboxes
    for (const box of this.boxes) {
      const isNext = !box.trap && box.orderIndex === this.nextOrder;
      const boxSize = 28;
      const half = boxSize / 2;

      ctx.fillStyle = box.checked
        ? box.trap
          ? THEME.stampRed
          : THEME.stampBlue
        : THEME.paperLight;
      ctx.fillRect(box.x - half, box.y - half, boxSize, boxSize);

      ctx.strokeStyle = isNext ? THEME.formBlue : THEME.ink;
      ctx.lineWidth = isNext ? 3 : 2;
      ctx.strokeRect(box.x - half, box.y - half, boxSize, boxSize);

      // Dwell progress arc around box
      if (box.dwellMs > 0 && !box.checked) {
        const thresh = box.trap ? TRAP_DWELL_MS : TARGET_DWELL_MS;
        const frac = Math.min(1, box.dwellMs / thresh);
        ctx.strokeStyle = box.trap ? THEME.stampRed : THEME.stampBlue;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(box.x, box.y, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }

      // Checkmark or step number
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (box.checked) {
        ctx.fillStyle = THEME.paperLight;
        ctx.font = `700 15px ${FONT_LABEL}`;
        ctx.fillText(box.trap ? "X" : "OK", box.x, box.y + 1);
      } else if (!box.trap) {
        ctx.fillStyle = isNext ? THEME.formBlue : THEME.ink;
        ctx.font = `700 15px ${FONT_LABEL}`;
        ctx.fillText(String(box.orderIndex + 1), box.x, box.y + 1);
      }

      // Paper label tag under box
      ctx.font = `${isNext ? 700 : 500} 12px ${FONT_TYPE}`;
      const labelW = Math.min(200, ctx.measureText(box.label).width + 14);
      const lx = box.x - labelW / 2;
      const ly = box.y + 20;
      ctx.fillStyle = isNext ? THEME.paperLight : THEME.paper;
      ctx.fillRect(lx, ly, labelW, 21);
      ctx.strokeStyle = isNext ? THEME.formBlue : THEME.ink;
      ctx.lineWidth = isNext ? 2 : 1;
      ctx.strokeRect(lx, ly, labelW, 21);
      ctx.fillStyle = THEME.ink;
      ctx.fillText(box.label, box.x, ly + 11, labelW - 8);
    }

    // Dual-stroke nose cursor crosshair for contrast on both CCTV darks and paper boxes
    ctx.strokeStyle = THEME.paperLight;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(this.cursor.x, this.cursor.y, 12, 0, Math.PI * 2);
    ctx.moveTo(this.cursor.x - 18, this.cursor.y);
    ctx.lineTo(this.cursor.x + 18, this.cursor.y);
    ctx.moveTo(this.cursor.x, this.cursor.y - 18);
    ctx.lineTo(this.cursor.x, this.cursor.y + 18);
    ctx.stroke();

    ctx.strokeStyle = THEME.stampRed;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(this.cursor.x, this.cursor.y, 12, 0, Math.PI * 2);
    ctx.moveTo(this.cursor.x - 18, this.cursor.y);
    ctx.lineTo(this.cursor.x + 18, this.cursor.y);
    ctx.moveTo(this.cursor.x, this.cursor.y - 18);
    ctx.lineTo(this.cursor.x, this.cursor.y + 18);
    ctx.stroke();

    // Unified HUD
    drawProgressLine(ctx, vp, progress, {
      danger: this.status === "failed",
      accent: this.tickFlashMs > 0 ? THEME.stampBlue : THEME.paper,
    });
    drawTimerTag(ctx, vp, Math.max(0, this.durationMs - this.elapsedMs), {
      counter: `${this.nextOrder}/${this.targetCount}`,
    });

    ctx.restore();
  }

  getResult(): ChallengeResult {
    const progress =
      this.status === "passed" ? 1 : Math.min(0.99, this.nextOrder / Math.max(1, this.targetCount));
    return {
      status: this.status,
      progress,
      milestones: this.nextOrder,
      ...(this.callout !== undefined ? { callout: this.callout } : {}),
      ...(this.evidence !== undefined ? { evidence: this.evidence } : {}),
    };
  }
}
