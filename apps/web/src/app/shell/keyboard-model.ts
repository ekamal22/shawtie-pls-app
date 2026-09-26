export interface KeyboardInput {
  readonly textFocused: boolean;
  /** `visualViewport.height`, or the layout height when the API is missing. */
  readonly visualHeight: number;
  /** `window.innerHeight` right now. */
  readonly layoutHeight: number;
  /** `window.innerHeight` the last time no text field had focus (0 when unknown). */
  readonly stableLayoutHeight: number;
}

/**
 * Decides whether a virtual keyboard is likely open. Browsers report it two ways: the visual
 * viewport shrinks while the layout viewport stays put, or (Chrome on Android with
 * `interactive-widget=resizes-content`) the layout viewport itself shrinks, so both heights
 * drop together and the visual-only check never fires. A text field must have focus in
 * either case, and a URL bar moving the height a few percent is not treated as a keyboard.
 */
export function keyboardLikelyOpen(input: KeyboardInput): boolean {
  if (!input.textFocused) return false;
  const visualShrunk = input.visualHeight < input.layoutHeight * 0.8;
  const layoutShrunk =
    input.stableLayoutHeight > 0 && input.layoutHeight < input.stableLayoutHeight * 0.85;
  return visualShrunk || layoutShrunk;
}
