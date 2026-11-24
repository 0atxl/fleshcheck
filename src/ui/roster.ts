import type { DepartmentVerdict } from "../game/case-file";
import type { ChallengeId, ChallengeManifest } from "../game/types";

export interface RosterHandle {
  update(activeId: ChallengeId, getVerdict: (id: ChallengeId) => DepartmentVerdict): void;
}

/**
 * Renders the Office of Biological Verification inspection roster above the
 * form card so visitors can choose any of the 10 compliance tests freely.
 */
export function mountInspectionRoster(
  challenges: readonly ChallengeManifest[],
  initialId: ChallengeId,
  getVerdict: (id: ChallengeId) => DepartmentVerdict,
  onSelect: (manifest: ChallengeManifest) => void,
): RosterHandle {
  const main = document.querySelector("main.main-shell");
  const dossier = main?.querySelector(".dossier-card");
  if (!main) {
    return { update: () => {} };
  }

  const nav = document.createElement("nav");
  nav.className = "roster-bar";
  nav.setAttribute("aria-label", "Inspection roster");

  const head = document.createElement("div");
  head.className = "roster-head";

  const heading = document.createElement("span");
  heading.className = "roster-heading";
  heading.textContent = "INSPECTION ROSTER";

  const count = document.createElement("span");
  count.className = "roster-count";

  head.append(heading, count);
  nav.append(head);

  const list = document.createElement("ul");
  list.className = "roster-list";
  list.setAttribute("role", "list");

  const buttons = new Map<ChallengeId, { btn: HTMLButtonElement; dot: HTMLSpanElement }>();

  for (const ch of challenges) {
    const li = document.createElement("li");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "roster-btn";
    btn.dataset.challengeId = ch.id;

    const dot = document.createElement("span");
    dot.className = "roster-dot";
    dot.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.textContent = ch.title;

    btn.append(dot, label);
    btn.addEventListener("click", () => {
      onSelect(ch);
    });

    li.append(btn);
    list.append(li);
    buttons.set(ch.id, { btn, dot });
  }

  nav.append(list);

  if (dossier) {
    main.insertBefore(nav, dossier);
  } else {
    main.prepend(nav);
  }

  function update(activeId: ChallengeId, lookupVerdict: (id: ChallengeId) => DepartmentVerdict): void {
    let cleared = 0;
    for (const [id, entry] of buttons) {
      const verdict = lookupVerdict(id);
      if (verdict === "CLEARED") cleared += 1;
      entry.btn.setAttribute("aria-pressed", String(id === activeId));
      entry.dot.setAttribute("data-verdict", verdict);
    }
    count.textContent = `${cleared}/${challenges.length} cleared`;
  }

  update(initialId, getVerdict);

  return { update };
}
