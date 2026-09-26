import { useEffect, useState } from "react";
import { keyboardLikelyOpen } from "./keyboard-model.ts";

function isTextEntry(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "file", "submit", "reset"].includes(
      element.type,
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * True while a virtual keyboard is likely open on a touch device: a text field has focus and
 * either the visual viewport or the layout viewport has shrunk (see `keyboardLikelyOpen`). The shell hides the bottom navigation so the composer owns
 * the bottom edge. Never used on fine-pointer devices.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const coarse =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) return;
    const viewport = window.visualViewport;
    let stableHeight = window.innerHeight;
    const evaluate = () => {
      const textFocused = isTextEntry(document.activeElement);
      // Remember the full height whenever nothing is being typed, so a later shrink is visible.
      if (!textFocused) stableHeight = window.innerHeight;
      setOpen(
        keyboardLikelyOpen({
          textFocused,
          visualHeight: viewport ? viewport.height : window.innerHeight,
          layoutHeight: window.innerHeight,
          stableLayoutHeight: stableHeight,
        }),
      );
    };
    const onFocusOut = () => window.setTimeout(evaluate, 0);
    document.addEventListener("focusin", evaluate);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("resize", evaluate);
    viewport?.addEventListener("resize", evaluate);
    return () => {
      document.removeEventListener("focusin", evaluate);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("resize", evaluate);
      viewport?.removeEventListener("resize", evaluate);
    };
  }, []);

  return open;
}
