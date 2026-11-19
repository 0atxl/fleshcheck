import { describe, expect, it } from "vitest";
import { STAMPS_PASS, STAMPS_REJECT } from "../src/copy/global";
import { pickStampText } from "../src/output/stamp";

describe("stamp wording", () => {
  it("is stable per seed so the hanging stamp matches the stamp on the card", () => {
    for (const seed of [1, 7, 12345, 99999]) {
      expect(pickStampText(seed, false)).toBe(pickStampText(seed, false));
      expect(pickStampText(seed, true)).toBe(pickStampText(seed, true));
    }
  });

  it("draws from the right list for the outcome", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(STAMPS_REJECT as readonly string[]).toContain(pickStampText(seed, false));
      expect(STAMPS_PASS as readonly string[]).toContain(pickStampText(seed, true));
    }
  });

  it("varies across days", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) seen.add(pickStampText(seed, false));
    expect(seen.size).toBeGreaterThan(3);
  });
});
