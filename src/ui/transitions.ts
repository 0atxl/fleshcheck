let supportsDisplayTransition: boolean | undefined;

/**
 * Probes actual discrete display transition support (guards Firefox bug 1882408
 * where CSS.supports returns true without transitioning display).
 */
export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === "undefined" || !window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    supportsDisplayTransition = false;
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
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
