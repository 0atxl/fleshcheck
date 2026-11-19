import { describe, expect, it } from "vitest";
import { buildCopyContext, hasTemplateTokens, renderCopy } from "../src/copy/template";
import { CaseFileStore } from "../src/game/case-file";

describe("copy templating", () => {
  it("renders all supported tokens when context is complete", () => {
    const ctx = {
      weekday: "Thursday",
      time: "14:23",
      streak: 9,
      tries: 4,
      lastResult: "absent",
      case: "#12",
    };

    expect(renderCopy("It is {time} on a {weekday}. Of course you are here.", ctx)).toBe(
      "It is 14:23 on a Thursday. Of course you are here.",
    );
    expect(renderCopy("Case {case}: streak {streak}, tries {tries}, last '{lastResult}'.", ctx)).toBe(
      "Case #12: streak 9, tries 4, last 'absent'.",
    );
  });

  it("passes non-templated lines through untouched even without context", () => {
    expect(hasTemplateTokens("Maintain a neutral face for the record.")).toBe(false);
    expect(renderCopy("Maintain a neutral face for the record.")).toBe(
      "Maintain a neutral face for the record.",
    );
  });

  it("drops or swaps lines when any referenced token is missing or unknown", () => {
    expect(renderCopy("Your streak of {streak} is noted.", {})).toBeNull();
    expect(renderCopy("Your streak of {streak} is noted.", undefined)).toBeNull();
    expect(renderCopy("Your streak of {streak} is noted.", {}, "Fallback line.")).toBe("Fallback line.");
    expect(renderCopy("Unknown {mystery} token.", { weekday: "Monday" })).toBeNull();
    // Guards against malformed values reintroducing braces
    expect(renderCopy("Last result: {lastResult}.", { lastResult: "{injected}" })).toBeNull();
    expect(renderCopy("Streak: {streak}.", { streak: -1 })).toBeNull();
  });

  it("builds local-only context from clock and case file", () => {
    const dt = new Date(2026, 10, 19, 9, 5); // Thursday 09:05 local
    const ctx = buildCopyContext({ caseNumber: 2, now: dt, streak: 0, tries: 3, lastResult: "rejected" });
    expect(ctx).toEqual({
      weekday: "Thursday",
      time: "09:05",
      case: "#02",
      streak: 0,
      tries: 3,
      lastResult: "rejected",
    });

    const fresh = buildCopyContext({ caseNumber: 12, now: dt });
    expect(fresh).toEqual({ weekday: "Thursday", time: "09:05", case: "#12" });
  });

  it("tracks lastResult in CaseFileStore across verdicts", () => {
    const store = new CaseFileStore(null);
    expect(store.getLastResult()).toBeUndefined();

    store.recordVerdict("POKER_FACE", 1, { passed: false, pct: 25, paused: false }, false);
    expect(store.getLastResult()).toBe("absent");

    store.recordVerdict("POKER_FACE", 1, { passed: false, pct: 68, paused: false }, false);
    expect(store.getLastResult()).toBe("rejected");

    store.recordVerdict("POKER_FACE", 1, { passed: true, pct: 100, paused: false }, false);
    expect(store.getLastResult()).toBe("cleared");
  });
});
