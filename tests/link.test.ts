import { describe, expect, it } from "vitest";
import { parseChallengeLink } from "../src/game/daily";

describe("friend challenge link parsing", () => {
  it("parses valid day and vs parameters within bounds", () => {
    expect(parseChallengeLink("?day=4&vs=31", 10)).toEqual({ dayOverride: 4, vsPct: 31 });
    expect(parseChallengeLink("day=1&vs=0", 1)).toEqual({ dayOverride: 1, vsPct: 0 });
    expect(parseChallengeLink("?day=10&vs=100", 10)).toEqual({ dayOverride: 10, vsPct: 100 });
  });

  it("ignores out-of-range, fractional, or malformed inputs", () => {
    expect(parseChallengeLink("?day=0&vs=101", 10)).toEqual({ dayOverride: null, vsPct: null });
    expect(parseChallengeLink("?day=11&vs=-5", 10)).toEqual({ dayOverride: null, vsPct: null });
    expect(parseChallengeLink("?day=2.5&vs=31abc", 10)).toEqual({ dayOverride: null, vsPct: null });
    expect(parseChallengeLink("?day=abc&vs=<script>", 10)).toEqual({ dayOverride: null, vsPct: null });
    expect(parseChallengeLink("", 10)).toEqual({ dayOverride: null, vsPct: null });
  });
});
