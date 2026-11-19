const MUTE_KEY = "fleshcheck:muted";

/**
 * Procedural WebAudio synthesizer for deadpan compliance SFX.
 * Unlocked on user click gesture; zero external audio assets.
 */
export class ComplianceSfx {
  private ctx: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    this.muted = readMuted();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    writeMuted(next);
  }

  unlock(): void {
    if (this.muted || typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  playTick(): void {
    this.withRunningContext((ctx) => this.scheduleTone(ctx, 720, 0.035, "square", 0.04));
  }

  playCalibrateHum(): void {
    this.withRunningContext((ctx) => this.scheduleTone(ctx, 180, 0.25, "sine", 0.04, 240));
  }

  playAlertBeep(): void {
    this.withRunningContext((ctx) => this.scheduleTone(ctx, 540, 0.09, "triangle", 0.06));
  }

  playStampThud(): void {
    this.withRunningContext((ctx) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(42, now + 0.18);

      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.21);
    });
  }

  playPassChime(): void {
    this.withRunningContext((ctx) => {
      this.scheduleTone(ctx, 523.25, 0.09, "sine", 0.07, undefined, 0);
      this.scheduleTone(ctx, 659.25, 0.14, "sine", 0.07, undefined, 0.09);
    });
  }

  playRoundAdvance(): void {
    this.withRunningContext((ctx) => {
      this.scheduleTone(ctx, 440, 0.06, "sine", 0.05, undefined, 0);
      this.scheduleTone(ctx, 554.37, 0.08, "sine", 0.05, undefined, 0.065);
    });
  }

  playMilestone(): void {
    this.withRunningContext((ctx) => {
      this.scheduleTone(ctx, 587.33, 0.045, "triangle", 0.045, undefined, 0);
      this.scheduleTone(ctx, 783.99, 0.06, "sine", 0.045, undefined, 0.045);
    });
  }

  close(): void {
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  /**
   * Executes a sound callback immediately when running, or chains onto resume()
   * so the very first click after unlocking audio is never silently dropped.
   */
  private withRunningContext(fn: (ctx: AudioContext) => void): void {
    if (this.muted || typeof window === "undefined") return;
    if (!this.ctx) this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;

    if (ctx.state === "running") {
      fn(ctx);
      return;
    }
    if (ctx.state === "suspended") {
      ctx
        .resume()
        .then(() => {
          if (!this.muted && this.ctx === ctx && ctx.state === "running") {
            fn(ctx);
          }
        })
        .catch(() => {});
    }
  }

  private scheduleTone(
    ctx: AudioContext,
    freq: number,
    durationSec: number,
    type: OscillatorType,
    volume: number,
    endFreq?: number,
    delaySec = 0,
  ): void {
    const start = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) {
      osc.frequency.linearRampToValueAtTime(endFreq, start + durationSec);
    }

    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + durationSec + 0.01);
  }
}

function readMuted(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage?.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.setItem(MUTE_KEY, muted ? "1" : "0");
    }
  } catch {
    // Ignore storage errors
  }
}
