import { describe, expect, it } from "vitest";
import {
  formatUtcCountdown,
  getMsUntilNextUtcDay,
  getUtcDayNumber,
  selectDailyChallenge,
} from "../src/game/daily";
import { PokerFaceChallenge } from "../src/game/challenges/poker-face";
import { ACTIVE_CHALLENGES } from "../src/game/registry";
import type { ChallengeManifest } from "../src/game/types";

function makeDummyManifest(id: ChallengeManifest["id"]): ChallengeManifest {
  return {
    id,
    title: id,
    department: id,
    prompt: "Hold still.",
    model: "face",
    durationMs: 12_000,
    enabled: true,
    copy: { callouts: ["FAILED"] },
    create: () => new PokerFaceChallenge(),
  };
}

describe("daily UTC rotation", () => {
  it("produces the exact same day number for the same UTC instant across timezone offsets", () => {
    const epoch = Date.UTC(2026, 10, 18); // 2026-11-18T00:00:00Z
    // 2026-11-20T01:30:00-08:00 == 2026-11-20T09:30:00Z
    const laInstant = Date.parse("2026-11-20T01:30:00-08:00");
    // 2026-11-20T15:00:00+05:30 == 2026-11-20T09:30:00Z
    const kolkataInstant = Date.parse("2026-11-20T15:00:00+05:30");

    const dayLa = getUtcDayNumber(laInstant, epoch);
    const dayKolkata = getUtcDayNumber(kolkataInstant, epoch);

    expect(dayLa).toBe(3);
    expect(dayKolkata).toBe(3);

    const roster = [makeDummyManifest("POKER_FACE"), makeDummyManifest("NOSE_SPOON"), makeDummyManifest("BOT_DODGE")];
    expect(selectDailyChallenge(dayLa, roster).challenge.id).toBe(
      selectDailyChallenge(dayKolkata, roster).challenge.id,
    );
  });

  it("never picks the same challenge two days in a row when multiple challenges are active", () => {
    const roster = [
      makeDummyManifest("POKER_FACE"),
      makeDummyManifest("NOSE_SPOON"),
      makeDummyManifest("BOT_DODGE"),
    ];

    let prevId: string | null = null;
    for (let day = 1; day <= 90; day++) {
      const picked = selectDailyChallenge(day, roster);
      expect(picked.challenge.id).not.toBe(prevId);
      prevId = picked.challenge.id;
    }
  });

  it("handles a single active challenge cleanly", () => {
    const roster = [makeDummyManifest("POKER_FACE")];
    expect(selectDailyChallenge(1, roster).challenge.id).toBe("POKER_FACE");
    expect(selectDailyChallenge(2, roster).challenge.id).toBe("POKER_FACE");
  });

  it("rotates the full active challenge roster without repeating consecutive days", () => {
    expect(ACTIVE_CHALLENGES.length).toBeGreaterThanOrEqual(4);
    const seen = new Set<string>();
    let prevId: string | null = null;
    for (let day = 1; day <= 60; day++) {
      const picked = selectDailyChallenge(day, ACTIVE_CHALLENGES);
      expect(picked.challenge.id).not.toBe(prevId);
      prevId = picked.challenge.id;
      seen.add(picked.challenge.id);
    }
    expect(seen.size).toBe(ACTIVE_CHALLENGES.length);
  });

  it("computes remaining milliseconds until UTC midnight and formats HH:MM:SS countdowns", () => {
    const t = Date.parse("2026-11-20T19:47:51.000Z");
    const rem = getMsUntilNextUtcDay(t);
    expect(rem).toBe((4 * 3600 + 12 * 60 + 9) * 1000);
    expect(formatUtcCountdown(rem)).toBe("04:12:09");
    expect(formatUtcCountdown(0)).toBe("00:00:00");
    expect(formatUtcCountdown(500)).toBe("00:00:01");
  });
});
