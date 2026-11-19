const MUTE_KEY = "fleshcheck:muted";
const CLACK_MIN_GAP_MS = 55;
const NOISE_BUFFER_SEC = 0.6;

interface AmbientHumNodes {
  oscLow: OscillatorNode;
  oscHarm: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Procedural WebAudio synthesizer for deadpan compliance SFX.
 * Unlocked on user click gesture; zero external audio assets.
 */
export class ComplianceSfx {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private humNodes: AmbientHumNodes | null = null;
  private humDesired = false;
  private lastClackMs = -Infinity;
  private clackStep = 0;
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
    if (next) {
      this.teardownHum(0.05);
    } else if (this.humDesired) {
      this.startAmbientHum();
    }
  }

  unlock(): void {
    if (this.muted || typeof window === "undefined") return;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) {
      try {
        this.ctx = new Ctx();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  /** Crisp mechanical checkbox / switch tick. */
  playTick(): void {
    this.withRunningContext((ctx) => {
      this.scheduleNoiseBurst(ctx, {
        durationSec: 0.018,
        filterType: "bandpass",
        freq: 2100,
        q: 1.8,
        volume: 0.08,
        attackSec: 0.001,
      });
      this.scheduleTone(ctx, 760, 0.028, "triangle", 0.03, 520);
    });
  }

  /** Subtle intake cue when calibration begins. */
  playCalibrateHum(): void {
    this.withRunningContext((ctx) => this.scheduleTone(ctx, 180, 0.22, "sine", 0.035, 220));
  }

  /** Dry bureaucratic attention tone on pause / tracking loss. */
  playAlertBeep(): void {
    this.withRunningContext((ctx) => this.scheduleTone(ctx, 520, 0.09, "triangle", 0.055));
  }

  /**
   * Rubber-stamp impact: short filtered noise transient plus a low sine drop
   * (90 Hz -> 45 Hz) with a tight desk-body decay.
   */
  playStampThud(): void {
    this.withRunningContext((ctx) => {
      const now = ctx.currentTime;

      // 1. Rubber-on-paper impact transient
      this.scheduleNoiseBurst(ctx, {
        durationSec: 0.052,
        filterType: "bandpass",
        freq: 680,
        q: 0.85,
        volume: 0.26,
        attackSec: 0.002,
      });

      // 2. Low desk body drop (~90 Hz to 45 Hz)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(92, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.14);

      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.32, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.17);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        safeDisconnect(osc);
        safeDisconnect(gain);
      };
      osc.start(now);
      osc.stop(now + 0.18);
    });
  }

  /** Filtered noise rustle played as the paper evidence dossier appears. */
  playPaperRustle(): void {
    this.withRunningContext((ctx) => {
      this.scheduleNoiseBurst(ctx, {
        durationSec: 0.22,
        filterType: "bandpass",
        freq: 1700,
        endFreq: 2700,
        q: 1.1,
        volume: 0.085,
        attackSec: 0.045,
      });
    });
  }

  /** Very short filtered-noise typewriter clack, rate-capped to avoid machine-gun bursts. */
  playTypeClack(): void {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - this.lastClackMs < CLACK_MIN_GAP_MS) return;
    this.lastClackMs = nowMs;

    const pitch = 2350 + (this.clackStep % 3) * 260;
    this.clackStep += 1;

    this.withRunningContext((ctx) => {
      this.scheduleNoiseBurst(ctx, {
        durationSec: 0.015,
        filterType: "bandpass",
        freq: pitch,
        q: 2.3,
        volume: 0.075,
        attackSec: 0.001,
      });
    });
  }

  /** Quiet fluorescent-ballast ambient hum faded in during calibration and active play. */
  startAmbientHum(): void {
    this.humDesired = true;
    if (this.muted || this.humNodes) return;

    this.withRunningContext((ctx) => {
      if (!this.humDesired || this.muted || this.humNodes) return;
      try {
        const now = ctx.currentTime;
        const oscLow = ctx.createOscillator();
        const oscHarm = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();

        oscLow.type = "sine";
        oscLow.frequency.setValueAtTime(60, now);

        oscHarm.type = "triangle";
        oscHarm.frequency.setValueAtTime(120, now);

        filter.type = "lowpass";
        filter.frequency.setValueAtTime(210, now);
        filter.Q.setValueAtTime(0.7, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.014, now + 0.35);

        oscLow.connect(filter);
        oscHarm.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        oscLow.start(now);
        oscHarm.start(now);

        this.humNodes = { oscLow, oscHarm, filter, gain };
      } catch {
        this.humNodes = null;
      }
    });
  }

  /** Smoothly fades out and disconnects the ambient hum. Safe to call on every exit path. */
  stopAmbientHum(): void {
    this.humDesired = false;
    this.teardownHum(0.22);
  }

  playPassChime(): void {
    this.withRunningContext((ctx) => {
      this.scheduleTone(ctx, 523.25, 0.09, "sine", 0.065, undefined, 0);
      this.scheduleTone(ctx, 659.25, 0.14, "sine", 0.065, undefined, 0.09);
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
    this.humDesired = false;
    this.teardownHum(0);
    this.noiseBuffer = null;
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  private teardownHum(fadeSec: number): void {
    const nodes = this.humNodes;
    if (!nodes) return;
    this.humNodes = null;

    const cleanup = () => {
      safeDisconnect(nodes.oscLow);
      safeDisconnect(nodes.oscHarm);
      safeDisconnect(nodes.filter);
      safeDisconnect(nodes.gain);
    };

    const ctx = this.ctx;
    if (!ctx || fadeSec <= 0) {
      try {
        nodes.oscLow.stop();
        nodes.oscHarm.stop();
      } catch {
        // Ignore already-stopped oscillators
      }
      cleanup();
      return;
    }

    try {
      const now = ctx.currentTime;
      nodes.gain.gain.cancelScheduledValues(now);
      const current = Math.max(0.0001, nodes.gain.gain.value || 0.014);
      nodes.gain.gain.setValueAtTime(current, now);
      nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
      const stopAt = now + fadeSec + 0.02;
      nodes.oscLow.onended = cleanup;
      nodes.oscLow.stop(stopAt);
      nodes.oscHarm.stop(stopAt);
    } catch {
      cleanup();
    }
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    if (typeof ctx.createBuffer !== "function") return null;
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_BUFFER_SEC));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    // Deterministic-feel noise without Math.random concerns; fast white noise fill
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private scheduleNoiseBurst(
    ctx: AudioContext,
    opts: {
      durationSec: number;
      filterType: BiquadFilterType;
      freq: number;
      endFreq?: number;
      q: number;
      volume: number;
      attackSec: number;
      delaySec?: number;
    },
  ): void {
    const buffer = this.getNoiseBuffer(ctx);
    if (!buffer || typeof ctx.createBufferSource !== "function" || typeof ctx.createBiquadFilter !== "function") {
      return;
    }

    const start = ctx.currentTime + (opts.delaySec ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.setValueAtTime(opts.freq, start);
    if (opts.endFreq !== undefined) {
      filter.frequency.linearRampToValueAtTime(opts.endFreq, start + opts.durationSec);
    }
    filter.Q.setValueAtTime(opts.q, start);

    const gain = ctx.createGain();
    const peakAt = start + Math.min(opts.attackSec, opts.durationSec * 0.5);
    gain.gain.setValueAtTime(0.0005, start);
    gain.gain.linearRampToValueAtTime(opts.volume, peakAt);
    gain.gain.exponentialRampToValueAtTime(0.0005, start + opts.durationSec);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.onended = () => {
      safeDisconnect(src);
      safeDisconnect(filter);
      safeDisconnect(gain);
    };

    const maxOffset = Math.max(0, buffer.duration - opts.durationSec - 0.02);
    const offset = maxOffset > 0 ? Math.random() * maxOffset : 0;
    src.start(start, offset, opts.durationSec + 0.01);
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
    osc.onended = () => {
      safeDisconnect(osc);
      safeDisconnect(gain);
    };
    osc.start(start);
    osc.stop(start + durationSec + 0.01);
  }
}

function safeDisconnect(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // Ignore disconnect errors on already-detached nodes
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
