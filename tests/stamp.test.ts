import { afterEach, describe, expect, it } from "vitest";
import { STAMPS_CALM, STAMPS_PASS, STAMPS_REJECT } from "../src/copy/global";
import { renderEvidenceCard } from "../src/output/evidence-card";
import { pickStampText } from "../src/output/stamp";

const origDoc = globalThis.document;

afterEach(() => {
  globalThis.document = origDoc;
});

function makeSpyCanvas() {
  const texts: string[] = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    clearRect: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
    measureText: (t: string) => ({ width: t.length * 7 }),
    fillText: (text: string) => {
      texts.push(text);
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  } as unknown as CanvasRenderingContext2D;
  return { width: 0, height: 0, texts, getContext: () => ctx };
}

describe("stamp wording", () => {
  it("is stable per seed so the hanging stamp matches the stamp on the card", () => {
    for (const seed of [1, 7, 12345, 99999]) {
      expect(pickStampText(seed, false)).toBe(pickStampText(seed, false));
      expect(pickStampText(seed, true)).toBe(pickStampText(seed, true));
      expect(pickStampText(seed, true, "too-calm")).toBe(pickStampText(seed, true, "too-calm"));
    }
  });

  it("draws from the right list for the outcome and too-calm variant", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(STAMPS_REJECT as readonly string[]).toContain(pickStampText(seed, false));
      expect(STAMPS_PASS as readonly string[]).toContain(pickStampText(seed, true));
      expect(STAMPS_CALM as readonly string[]).toContain(pickStampText(seed, true, "too-calm"));
    }
  });

  it("varies across days", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) seen.add(pickStampText(seed, false));
    expect(seen.size).toBeGreaterThan(3);
  });

  it("uses explicit stampText override when rendering an evidence card", () => {
    const stampTexts: string[] = [];
    globalThis.document = {
      createElement: () => {
        const c = makeSpyCanvas();
        const origFillText = c.getContext().fillText;
        c.getContext().fillText = (text: string, x: number, y: number, maxW?: number) => {
          stampTexts.push(text);
          origFillText(text, x, y, maxW);
        };
        return c;
      },
    } as unknown as Document;

    const cardCanvas = makeSpyCanvas() as unknown as HTMLCanvasElement;
    renderEvidenceCard(cardCanvas, {
      dayNumber: 2,
      title: "Poker Face",
      department: "Affect Review",
      pct: 100,
      passed: true,
      callout: "EXCESSIVE COMPOSURE LOGGED ON FORM 27-B",
      tries: [{ passed: true, pct: 100, paused: false }],
      elapsedMs: 12_000,
      durationMs: 12_000,
      seed: 42,
      isReplay: false,
      snapshot: null,
      stampText: "CLEARED: FLAGGED FOR EXCESSIVE COMPOSURE",
    });

    expect(stampTexts).toContain("CLEARED");
    expect(stampTexts).toContain("FLAGGED FOR EXCESSIVE COMPOSURE");
  });
});
