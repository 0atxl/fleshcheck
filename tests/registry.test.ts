import { describe, expect, it } from "vitest";
import { STAMPS_PASS, STAMPS_REJECT } from "../src/copy/global";
import { ACTIVE_CHALLENGES, CHALLENGES } from "../src/game/registry";

describe("challenge registry", () => {
  it("contains unique IDs and departments and valid metadata", () => {
    const ids = new Set<string>();
    const departments = new Set<string>();

    expect(ACTIVE_CHALLENGES.length).toBeGreaterThan(0);

    for (const c of CHALLENGES) {
      expect(ids.has(c.id)).toBe(false);
      expect(departments.has(c.department)).toBe(false);
      ids.add(c.id);
      departments.add(c.department);

      expect(["face", "hands"]).toContain(c.model);
      expect(c.durationMs).toBeGreaterThan(0);
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  it("enforces copy bank minimums for enabled challenges and global stamps", () => {
    expect(STAMPS_REJECT.length + STAMPS_PASS.length).toBeGreaterThanOrEqual(15);

    for (const c of ACTIVE_CHALLENGES) {
      if (c.id === "POKER_FACE") {
        expect(c.copy.taunts?.length ?? 0).toBeGreaterThanOrEqual(35);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(8);
      } else if (c.id === "NOSE_SPOON") {
        expect(c.copy.commentary?.length ?? 0).toBeGreaterThanOrEqual(15);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "BOT_DODGE") {
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "PASSPORT_PHOTO") {
        expect(c.copy.rules?.length ?? 0).toBeGreaterThanOrEqual(20);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "MOUTH_CATCH") {
        expect(c.copy.forms?.length ?? 0).toBeGreaterThanOrEqual(10);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "AFFECT_DEMO") {
        expect(c.copy.prompts?.length ?? 0).toBeGreaterThanOrEqual(12);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "INTERVIEW") {
        expect(c.copy.questions?.length ?? 0).toBeGreaterThanOrEqual(40);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
      } else if (c.id === "NOSE_CURSOR") {
        expect(c.copy.checkboxes?.length ?? 0).toBeGreaterThanOrEqual(20);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(8);
      } else if (c.id === "EYES_ON_FORM") {
        expect(c.copy.popups?.length ?? 0).toBeGreaterThanOrEqual(25);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(8);
      } else if (c.id === "FULL_AUDIT") {
        expect(c.copy.transitions?.length ?? 0).toBeGreaterThanOrEqual(5);
        expect(c.copy.callouts.length).toBeGreaterThanOrEqual(10);
        expect(c.maxTries).toBe(1);
      }
    }
  });
});
