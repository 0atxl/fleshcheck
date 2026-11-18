import type { ChallengeId, ChallengeManifest } from "../game/types";

export interface DevSwitcherHandle {
  updateActive(id: ChallengeId): void;
}

/**
 * Renders a dev-only challenge switcher bar (tree-shaken in production builds).
 */
export function mountDevSwitcher(
  challenges: readonly ChallengeManifest[],
  initialId: ChallengeId,
  onSelect: (manifest: ChallengeManifest) => void,
): DevSwitcherHandle {
  const main = document.querySelector("main.main-shell");
  if (!main) {
    return { updateActive: () => {} };
  }

  const bar = document.createElement("div");
  bar.className = "dev-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "Dev challenge switcher");

  const label = document.createElement("span");
  label.className = "dev-bar-label";
  label.textContent = "DEV TEST:";
  bar.append(label);

  const buttons = new Map<ChallengeId, HTMLButtonElement>();

  for (const ch of challenges) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-quiet";
    btn.textContent = ch.title;
    btn.setAttribute("aria-pressed", String(ch.id === initialId));
    btn.addEventListener("click", () => {
      onSelect(ch);
    });
    buttons.set(ch.id, btn);
    bar.append(btn);
  }

  main.prepend(bar);

  return {
    updateActive(id: ChallengeId) {
      for (const [key, btn] of buttons) {
        btn.setAttribute("aria-pressed", String(key === id));
      }
    },
  };
}
