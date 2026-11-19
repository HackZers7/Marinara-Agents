// ──────────────────────────────────────────────
// Story Writer: keyboard behavior shared by the package's aria-modal dialogs (PromptPeek's pattern)
// ──────────────────────────────────────────────
import type { KeyboardEvent } from "react";

/**
 * aria-modal: Tab and Shift+Tab wrap inside the dialog, never out to the Engine's tabs, where Escape would no longer
 * reach the dialog. Only the wrap is handled: past the last stop, or before the first, focus goes round; anywhere
 * else the browser moves on as usual. The focusable stops are read from `container` with `selector`, so each dialog
 * lists what it can hold (a summary fold is a stop only where one exists).
 */
export function keepTabInside(event: KeyboardEvent, container: HTMLElement, selector: string): void {
  const stops = Array.from(container.querySelectorAll<HTMLElement>(selector));
  const active = document.activeElement;
  if (!active || !stops.length) return;
  const order = (stop: HTMLElement) => active.compareDocumentPosition(stop);
  const more = event.shiftKey
    ? stops.some((stop) => order(stop) & Node.DOCUMENT_POSITION_PRECEDING)
    : stops.some((stop) => order(stop) & Node.DOCUMENT_POSITION_FOLLOWING);
  if (!more) {
    event.preventDefault();
    (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
  }
}
