import { describe, expect, it } from "vitest";
import { CARD_WIDTH, renderEvidenceCard } from "../src/output/evidence-card";

interface DrawnTextCall {
  text: string;
  x: number;
  maxWidth: number | undefined;
  fontSize: number;
  measuredWidth: number;
}

function makeWideFallbackCanvas(): { canvas: HTMLCanvasElement; calls: DrawnTextCall[] } {
  const calls: DrawnTextCall[] = [];
  let font = "700 16px sans-serif";
  let textAlign: CanvasTextAlign = "left";

  const parseFontSize = (f: string): number => {
    const match = /(\d+(?:\.\d+)?)px/.exec(f);
    return match ? Number(match[1]) : 16;
  };

  // Simulate an unusually wide fallback font (~0.75em per glyph) to verify no right-edge clipping
  const measureWidth = (text: string): number => text.length * parseFontSize(font) * 0.75;

  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    textBaseline: "alphabetic",
    get font() {
      return font;
    },
    set font(v: string) {
      font = v;
    },
    get textAlign() {
      return textAlign;
    },
    set textAlign(v: CanvasTextAlign) {
      textAlign = v;
    },
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    arc: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    drawImage: () => {},
    measureText: (text: string) => ({ width: measureWidth(text) }),
    fillText: (text: string, x: number, _y: number, maxWidth?: number) => {
      const measured = measureWidth(text);
      const effectiveW = maxWidth !== undefined ? Math.min(measured, maxWidth) : measured;
      calls.push({
        text,
        x,
        maxWidth,
        fontSize: parseFontSize(font),
        measuredWidth: textAlign === "right" ? 0 : effectiveW,
      });
    },
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;

  return { canvas, calls };
}

describe("evidence card text fitting", () => {
  it("keeps header title and 100% HUMAN readout inside the card even under wide fallback fonts", () => {
    const { canvas, calls } = makeWideFallbackCanvas();
    renderEvidenceCard(canvas, {
      dayNumber: 7,
      title: "Eyes on Form",
      department: "Attention Audit",
      pct: 100,
      passed: true,
      callout: "COMPLIANCE VERIFIED",
      tries: [{ passed: true, pct: 100, paused: false }],
      elapsedMs: 12_000,
      durationMs: 12_000,
      seed: 12345,
      isReplay: false,
      snapshot: null,
      rankTitle: "Provisional Human",
    });

    const rightMarginLimit = CARD_WIDTH - 40; // RX(632) + RW(520) = 1152 <= 1160
    const titleCall = calls.find((c) => c.text === "BIOMETRIC COMPLIANCE RECORD");
    const humanCall = calls.find((c) => c.text === "HUMAN");
    const probCall = calls.find((c) => c.text === "PROBATIONARY");

    expect(titleCall).toBeDefined();
    expect(humanCall).toBeDefined();
    expect(probCall).toBeDefined();

    expect(titleCall!.x + titleCall!.measuredWidth).toBeLessThanOrEqual(rightMarginLimit);
    expect(humanCall!.x + humanCall!.measuredWidth).toBeLessThanOrEqual(rightMarginLimit);
    expect(probCall!.x + probCall!.measuredWidth).toBeLessThanOrEqual(rightMarginLimit);
  });
});
