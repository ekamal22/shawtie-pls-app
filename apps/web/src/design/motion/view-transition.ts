import { prefersReducedMotion } from "./reduced.ts";

/*
 * Two Sides / Memory Return (PRESENTATION_ONLY). A short shared-element style transition
 * built on the View Transitions API when the browser has it. It only changes how an existing
 * navigation is drawn: the same route change and the same `shawtie:open-message` event still
 * happen, and browsers without the API (or with reduced motion) simply update immediately.
 */

interface ViewTransitionLike {
  readonly finished: Promise<unknown>;
}
type StartViewTransition = (update: () => Promise<void> | void) => ViewTransitionLike;

export const SHARED_ELEMENT_NAME = "ux7-shared";
const MARK = "data-ux7-vt";

function starter(): StartViewTransition | null {
  const candidate = (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return typeof candidate === "function" ? candidate.bind(document) : null;
}

/** True only while a signature transition is being drawn. */
export function signatureTransitionActive(): boolean {
  return document.documentElement.dataset.ux7Transition !== undefined;
}

/** Names an element as the shared element of the running transition (no-op otherwise). */
export function nameSharedElement(element: HTMLElement | null): void {
  if (!element || !signatureTransitionActive()) return;
  element.style.setProperty("view-transition-name", SHARED_ELEMENT_NAME);
  element.setAttribute(MARK, "");
}

function clearNames(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[" + MARK + "]")) {
    element.style.removeProperty("view-transition-name");
    element.removeAttribute(MARK);
  }
  delete document.documentElement.dataset.ux7Transition;
}

/** Resolves after the next hashchange (or a short timeout) and two frames so React has drawn. */
export function afterNavigationSettles(timeoutMs = 300): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("hashchange", finish);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    window.addEventListener("hashchange", finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

/**
 * Runs `update` inside a short view transition. `from` (usually the kept card) becomes the
 * shared element on the outgoing side. Never delays or blocks the update beyond the timeout,
 * and never runs at all under reduced motion.
 */
export function runSignatureTransition(
  kind: string,
  update: () => Promise<void> | void,
  from?: HTMLElement | null,
): void {
  const start = prefersReducedMotion() ? null : starter();
  if (!start) {
    void update();
    return;
  }
  document.documentElement.dataset.ux7Transition = kind;
  nameSharedElement(from ?? null);
  try {
    void start(update).finished.then(clearNames, clearNames);
  } catch {
    clearNames();
    void update();
  }
}
