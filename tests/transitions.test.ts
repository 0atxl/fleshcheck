import { afterEach, describe, expect, it, vi } from "vitest";
import { canUseViewTransition, runSharedElementTransition } from "../src/ui/transitions";

const origDoc = globalThis.document;
const origWindow = globalThis.window;

afterEach(() => {
  globalThis.document = origDoc;
  globalThis.window = origWindow;
  vi.restoreAllMocks();
});

function makeFakeElement() {
  const attrs = new Map<string, string>();
  return {
    style: { viewTransitionName: "" },
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    hasAttribute: (k: string) => attrs.has(k),
  };
}

describe("View Transition shared-element helper", () => {
  it("falls back when startViewTransition is unsupported or reduced motion is requested", async () => {
    globalThis.document = { documentElement: makeFakeElement() } as unknown as Document;
    expect(canUseViewTransition(false)).toBe(false);

    const fromEl = makeFakeElement() as unknown as HTMLElement;
    const toEl = makeFakeElement() as unknown as HTMLElement;
    const updateDom = vi.fn();

    expect(
      await runSharedElementTransition({
        fromEl,
        toEl,
        transitionName: "booth-portal",
        reducedMotion: false,
        updateDom,
      }),
    ).toBe(false);
    expect(updateDom).not.toHaveBeenCalled();

    // Even when supported, reducedMotion must skip the view transition
    globalThis.document = {
      documentElement: makeFakeElement(),
      startViewTransition: vi.fn(),
    } as unknown as Document;
    expect(canUseViewTransition(true)).toBe(false);
    expect(canUseViewTransition(false)).toBe(true);
    expect(
      await runSharedElementTransition({
        fromEl,
        toEl,
        transitionName: "booth-portal",
        reducedMotion: true,
        updateDom,
      }),
    ).toBe(false);
  });

  it("hands off unique viewTransitionName strictly one-at-a-time and cleans up after finish", async () => {
    const root = makeFakeElement();
    const fromEl = makeFakeElement();
    const toEl = makeFakeElement();
    let resolveFinished!: () => void;
    const finished = new Promise<void>((r) => {
      resolveFinished = r;
    });

    const snapshots: Array<{ from: string; to: string; vtActive: boolean }> = [];
    globalThis.window = {
      setTimeout: () => 0,
    } as unknown as Window & typeof globalThis;
    globalThis.document = {
      documentElement: root,
      startViewTransition: (cb: () => void) => {
        // Capture "old" state snapshot before callback
        snapshots.push({
          from: fromEl.style.viewTransitionName,
          to: toEl.style.viewTransitionName,
          vtActive: root.hasAttribute("data-vt-active"),
        });
        cb();
        // Capture "new" state snapshot immediately after callback
        snapshots.push({
          from: fromEl.style.viewTransitionName,
          to: toEl.style.viewTransitionName,
          vtActive: root.hasAttribute("data-vt-active"),
        });
        return {
          finished,
          skipTransition: vi.fn(),
        };
      },
    } as unknown as Document;

    const onFinished = vi.fn();
    const updateDom = vi.fn();

    const promise = runSharedElementTransition({
      fromEl: fromEl as unknown as HTMLElement,
      toEl: toEl as unknown as HTMLElement,
      transitionName: "booth-portal",
      reducedMotion: false,
      updateDom,
      onFinished,
    });

    // Before finish: old snapshot had ONLY fromEl named; new snapshot had ONLY toEl named
    expect(snapshots).toEqual([
      { from: "booth-portal", to: "", vtActive: true },
      { from: "", to: "booth-portal", vtActive: true },
    ]);
    expect(updateDom).toHaveBeenCalledTimes(1);
    expect(onFinished).not.toHaveBeenCalled();

    resolveFinished();
    const used = await promise;
    expect(used).toBe(true);
    expect(onFinished).toHaveBeenCalledTimes(1);
    // All temporary transition state cleaned up
    expect(fromEl.style.viewTransitionName).toBe("");
    expect(toEl.style.viewTransitionName).toBe("");
    expect(root.hasAttribute("data-vt-active")).toBe(false);
  });

  it("cleans up state and falls back cleanly if startViewTransition throws", async () => {
    const root = makeFakeElement();
    const fromEl = makeFakeElement();
    const toEl = makeFakeElement();

    globalThis.document = {
      documentElement: root,
      startViewTransition: () => {
        throw new Error("Transition aborted");
      },
    } as unknown as Document;

    const used = await runSharedElementTransition({
      fromEl: fromEl as unknown as HTMLElement,
      toEl: toEl as unknown as HTMLElement,
      transitionName: "booth-portal",
      reducedMotion: false,
      updateDom: vi.fn(),
    });

    expect(used).toBe(false);
    expect(fromEl.style.viewTransitionName).toBe("");
    expect(toEl.style.viewTransitionName).toBe("");
    expect(root.hasAttribute("data-vt-active")).toBe(false);
  });
});
