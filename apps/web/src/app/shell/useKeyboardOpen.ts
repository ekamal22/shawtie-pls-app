import { useEffect, useState } from "react";

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
 * the visual viewport has shrunk. The shell hides the bottom navigation so the composer owns
 * the bottom edge. Never used on fine-pointer devices.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const coarse =
      typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) return;
    const viewport = window.visualViewport;
    const evaluate = () => {
      const shrunk = viewport ? viewport.height < window.innerHeight * 0.8 : true;
      setOpen(isTextEntry(document.activeElement) && shrunk);
    };
    document.addEventListener("focusin", evaluate);
    document.addEventListener("focusout", () => window.setTimeout(evaluate, 0));
    viewport?.addEventListener("resize", evaluate);
    return () => {
      document.removeEventListener("focusin", evaluate);
      viewport?.removeEventListener("resize", evaluate);
    };
  }, []);

  return open;
}
