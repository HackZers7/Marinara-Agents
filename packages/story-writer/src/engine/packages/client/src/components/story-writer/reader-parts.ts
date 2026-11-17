// ──────────────────────────────────────────────
// Story Writer: DOM ↔ Markdown mapping for Rewrite Part marker placement
// ──────────────────────────────────────────────
// A click in the book resolves to the clicked top-level block of a chapter body (a paragraph, heading, scene break or
// quote group — the same set the serializer treats as blocks). The pure placement layer then decides the marker's
// line position from that index; nothing here touches the caret or the selection.

import { MARKDOWN_BLOCK_ELEMENTS } from "../../lib/story-writer/markdown";

/**
 * The index of the top-level block of `body` that contains (or is nearest above) the caret range a click produced.
 * Returns null when the range is outside the body. Bare text the browser may keep as a direct child counts as the
 * block it opens, matching how htmlToMarkdown serializes it.
 */
export function partBlockIndexOfRange(body: HTMLElement, range: Range | null): number | null {
  if (!range || !body.contains(range.startContainer)) return null;
  let node: Node = range.startContainer;
  // Walk up to the block the caret is in, or the body's direct child that contains it.
  while (node.parentNode && node.parentNode !== body) node = node.parentNode;
  const children = Array.from(body.childNodes);
  let index = children.indexOf(node);
  if (index < 0) return null;
  // A bare text node or inline element counts as the block it belongs to: find the nearest block at or before it.
  const isBlock = (child: Node) =>
    child.nodeType === Node.ELEMENT_NODE && MARKDOWN_BLOCK_ELEMENTS.has((child as Element).tagName.toLowerCase());
  if (!isBlock(children[index]!)) {
    while (index > 0 && !isBlock(children[index - 1]!)) index -= 1;
    if (index > 0)
      index -= 1; // the nearest block above, so a click in loose text lands after that block's start
    else index = 0;
  }
  // Count only blocks before it: content-block indices match partBlockStarts on the Markdown side.
  let blockIndex = 0;
  for (let i = 0; i < index; i += 1) if (isBlock(children[i]!)) blockIndex += 1;
  return blockIndex;
}

/**
 * The chapter bodies' pin targets: the bordered blocks of a rendered body, in document order. A pin is the block
 * element carrying `data-sw-part-start` or `data-sw-part-end`; the UI renders its handle next to it.
 */
export function partPinTargets(body: HTMLElement): Array<{ role: "start" | "end"; element: HTMLElement }> {
  const pins: Array<{ role: "start" | "end"; element: HTMLElement }> = [];
  for (const element of body.querySelectorAll<HTMLElement>("[data-sw-part-start], [data-sw-part-end]")) {
    if (element.hasAttribute("data-sw-part-start")) pins.push({ role: "start", element });
    if (element.hasAttribute("data-sw-part-end")) pins.push({ role: "end", element });
  }
  return pins;
}

/**
 * The marker role whose pin sits at `target`, when the click landed on (or inside) a bordered block. Clicking a
 * placed marker removes it, so a pin hit must be detected before placement runs. A block carrying both borders (a
 * one-block span) resolves by height: the upper half is the start pin, the lower half the end pin.
 */
export function partPinRoleAt(target: Element | null, y?: number): "start" | "end" | null {
  if (!(target instanceof Element)) return null;
  const bordered = target.closest<HTMLElement>("[data-sw-part-start], [data-sw-part-end]");
  if (!bordered) return null;
  const hasStart = bordered.hasAttribute("data-sw-part-start");
  const hasEnd = bordered.hasAttribute("data-sw-part-end");
  if (hasStart && hasEnd) {
    if (y === undefined) return "start";
    const box = bordered.getBoundingClientRect();
    return y - box.top <= box.height / 2 ? "start" : "end";
  }
  return hasStart ? "start" : hasEnd ? "end" : null;
}
