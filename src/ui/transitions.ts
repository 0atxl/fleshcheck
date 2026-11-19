let supportsDisplayTransition: boolean | undefined;

/**
 * Probes actual discrete display transition support (guards Firefox bug 1882408
 * where CSS.supports returns true without transitioning display).
 */
export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    supportsDisplayTransition = false;
    return false;
  }
  const probe = document.createElement("div");
  probe.style.setProperty("transition", "display 1s allow-discrete", "important");
  probe.style.display = "block";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

export async function hidePanel(el: HTMLElement): Promise<void> {
  if (el.hidden) return;
  if (canTransitionDisplay()) {
    el.hidden = true;
  } else {
    el.setAttribute("data-closing", "");
  }

  const animations = typeof el.getAnimations === "function" ? el.getAnimations() : [];
  if (animations.length > 0) {
    await Promise.race([
      Promise.allSettled(animations.map((a) => a.finished)),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]);
  }

  if (el.hasAttribute("data-closing")) {
    el.removeAttribute("data-closing");
    el.hidden = true;
  }
}

export function showPanel(el: HTMLElement): void {
  el.removeAttribute("data-closing");
  el.hidden = false;
}

/**
 * Feature-detects the Same-Document View Transitions API while honoring
 * prefers-reduced-motion.
 */
export function canUseViewTransition(reducedMotion = false): boolean {
  if (reducedMotion || typeof document === "undefined") return false;
  return typeof document.startViewTransition === "function";
}

export interface SharedElementTransitionOptions {
  fromEl: HTMLElement | null;
  toEl: HTMLElement | null;
  transitionName: string;
  reducedMotion: boolean;
  updateDom: () => void;
  onFinished?: () => void;
}

let activeViewTransition: ViewTransition | null = null;

/** Cancels any currently running shared-element view transition. */
export function skipActiveViewTransition(): void {
  if (!activeViewTransition) return;
  try {
    activeViewTransition.skipTransition();
  } catch {
    // Ignore already-finished transition
  }
  activeViewTransition = null;
}

/**
 * Runs a shared-element same-document View Transition between `fromEl` and `toEl`,
 * ensuring at most one element carries `transitionName` before and after the DOM
 * update and cleaning up temporary transition names once finished.
 *
 * Returns `true` if the View Transitions API handled the transition, or `false`
 * when unsupported or reduced-motion is enabled (caller should use panel fade).
 */
export async function runSharedElementTransition(
  opts: SharedElementTransitionOptions,
): Promise<boolean> {
  const { fromEl, toEl, transitionName, reducedMotion, updateDom, onFinished } = opts;
  if (!canUseViewTransition(reducedMotion) || !fromEl || !toEl) {
    return false;
  }

  // Cancel any stale in-flight transition so rapid clicks never deadlock or collide
  skipActiveViewTransition();

  const root = document.documentElement;
  toEl.style.viewTransitionName = "";
  fromEl.style.viewTransitionName = transitionName;
  root?.setAttribute("data-vt-active", "");

  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      fromEl.style.viewTransitionName = "";
      updateDom();
      toEl.style.viewTransitionName = transitionName;
    });
  } catch {
    fromEl.style.viewTransitionName = "";
    toEl.style.viewTransitionName = "";
    root?.removeAttribute("data-vt-active");
    return false;
  }

  activeViewTransition = transition;

  const finishTimeout = new Promise<void>((resolve) => {
    if (typeof window !== "undefined") {
      window.setTimeout(resolve, 650);
    } else {
      resolve();
    }
  });

  try {
    await Promise.race([
      transition.finished.catch(() => undefined),
      finishTimeout,
    ]);
  } finally {
    if (activeViewTransition === transition) {
      activeViewTransition = null;
    }
    fromEl.style.viewTransitionName = "";
    toEl.style.viewTransitionName = "";
    root?.removeAttribute("data-vt-active");
    onFinished?.();
  }

  return true;
}
