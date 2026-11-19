const timers = new WeakMap<HTMLElement, number>();
let lastMessage = "";
let initialized = false;

interface CommandLikeEvent extends Event {
  command?: string;
  source?: HTMLElement | null;
}

/**
 * Registers declarative Invoker Commands (--copy) with a standard click
 * fallback when CommandEvent is unsupported.
 */
export function initCopyHandlers(): void {
  if (initialized || typeof document === "undefined") return;
  initialized = true;

  document.addEventListener(
    "command",
    (rawEvent) => {
      const event = rawEvent as CommandLikeEvent;
      const command = event.command ?? "";
      if (!command.startsWith("--copy")) return;
      const button = event.source;
      const target = event.target;
      if (button instanceof HTMLElement && target instanceof HTMLElement) {
        void copyTargetText(button, target);
      }
    },
    true,
  );

  if (!("CommandEvent" in window)) {
    document.addEventListener("click", (event) => {
      const rawTarget = event.target;
      if (!(rawTarget instanceof Element)) return;
      const button = rawTarget.closest('button[command^="--copy"]');
      if (!(button instanceof HTMLElement)) return;
      const targetId = button.getAttribute("commandfor");
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (target) {
        void copyTargetText(button, target);
      }
    });
  }
}

export async function copyTargetText(button: HTMLElement, target: HTMLElement): Promise<void> {
  const text =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value.trim()
      : target.innerText.trim();
  if (!text) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!legacyCopy(text)) {
      throw new Error("Copy failed");
    }
    reportCopyStatus(button, true);
  } catch {
    if (legacyCopy(text)) {
      reportCopyStatus(button, true);
    } else {
      reportCopyStatus(button, false);
    }
  }
}

function legacyCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.insetBlockStart = "0";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

function reportCopyStatus(button: HTMLElement, ok: boolean): void {
  const tip = button.nextElementSibling;
  if (!(tip instanceof HTMLElement)) return;

  const existing = timers.get(button);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }

  button.removeAttribute("data-copied");
  button.removeAttribute("data-failed");

  let message = ok ? "Copied" : "Copy failed";
  if (message === lastMessage) {
    message += "\u00A0";
  }
  lastMessage = message;

  tip.textContent = "";
  void button.offsetWidth;
  button.setAttribute(ok ? "data-copied" : "data-failed", "");

  requestAnimationFrame(() => {
    tip.textContent = message;
  });

  timers.set(
    button,
    window.setTimeout(() => {
      button.removeAttribute("data-copied");
      button.removeAttribute("data-failed");
      tip.textContent = "";
    }, 2000),
  );
}
