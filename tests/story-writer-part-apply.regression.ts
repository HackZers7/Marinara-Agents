import assert from "node:assert/strict";
import test from "node:test";
import { markdownToHtml } from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/markdown.ts";
import { partInSpanBlocks } from "../packages/story-writer/src/engine/packages/client/src/components/story-writer/reader-parts.ts";
import {
  PART_END_TOKEN,
  PART_START_TOKEN,
  applyPartRewrite,
  insertPartMarker,
  partMarkerStatus,
  partSpanOf,
  stripPartTokens,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/part-markers.ts";

// The chapter from the marker fixtures: a heading, two paragraphs, a scene break, a quote, a closing paragraph.
const CHAPTER = [
  "# The Storm",
  "It was a dark night.",
  "The wind howled.",
  "***",
  "> Run,\n> she said.",
  "After the storm.",
].join("\n\n");

/** The chapter with a ready pair around blocks `from` (inclusive) to `to` (exclusive). */
function marked(from: number, to: number): string {
  return insertPartMarker(insertPartMarker(CHAPTER, from, "start"), to, "end");
}

test("applyPartRewrite replaces the span and wraps the new text in the same marker pair", () => {
  const markdown = marked(1, 3);
  const result = applyPartRewrite(markdown, "A brand-new scene.");
  // All-or-nothing: before and after survive untouched, only the span is gone.
  assert.ok(result!.includes("# The Storm"));
  assert.ok(result!.includes("After the storm."));
  assert.ok(!result!.includes("It was a dark night.") && !result!.includes("The wind howled."));
  // The pair wraps exactly the replacement, ready for another iteration.
  assert.equal(partSpanOf(result!)?.span, "A brand-new scene.");
  assert.equal(partMarkerStatus(result!).kind, "ready");
  assert.ok(result!.indexOf(PART_START_TOKEN) < result!.indexOf("A brand-new scene."));
  assert.ok(result!.indexOf("A brand-new scene.") < result!.indexOf(PART_END_TOKEN));
});

test("a multi-paragraph replacement keeps its paragraphs and the pair wraps them all", () => {
  const result = applyPartRewrite(marked(1, 3), "First paragraph.\n\nSecond paragraph.\n\nThird.");
  assert.deepEqual(partSpanOf(result!), {
    before: "# The Storm",
    span: "First paragraph.\n\nSecond paragraph.\n\nThird.",
    after: "***\n\n> Run,\n> she said.\n\nAfter the storm.",
  });
});

test("the span is replaced at the chapter edges: whole chapter, and a span at either edge", () => {
  // The whole chapter between the markers: nothing survives but the replacement.
  const whole = applyPartRewrite(marked(0, 6), "Everything is new.");
  assert.deepEqual(partSpanOf(whole!), { before: "", span: "Everything is new.", after: "" });
  assert.equal(stripPartTokens(whole!), "Everything is new.");
  // A span at the very start: no leading blank block appears before the start token.
  const leading = applyPartRewrite(marked(0, 1), "New opening.");
  assert.equal(leading!.indexOf(PART_START_TOKEN), 0);
  assert.deepEqual(partSpanOf(leading!), {
    before: "",
    span: "New opening.",
    after: CHAPTER.slice(CHAPTER.indexOf("It was")),
  });
  // A span at the very end: no trailing blank block after the end token.
  const trailing = applyPartRewrite(marked(5, 6), "New ending.");
  assert.ok(trailing!.endsWith(PART_END_TOKEN));
  assert.deepEqual(partSpanOf(trailing!), {
    before: CHAPTER.slice(0, CHAPTER.lastIndexOf("\n\n")),
    span: "New ending.",
    after: "",
  });
});

test("an empty draft empties the span without corrupting the pair or the neighbors", () => {
  const result = applyPartRewrite(marked(1, 3), "");
  assert.equal(partMarkerStatus(result!).kind, "ready");
  assert.deepEqual(partSpanOf(result!), {
    before: "# The Storm",
    span: "",
    after: "***\n\n> Run,\n> she said.\n\nAfter the storm.",
  });
  // Whitespace-only edits are an empty draft too.
  assert.equal(applyPartRewrite(marked(1, 3), "  \n\n  "), result);
});

test("a hand edit that carries marker tokens cannot smuggle them into the chapter twice", () => {
  const smuggled = applyPartRewrite(marked(1, 3), `Clean prose.\n\n${PART_START_TOKEN}\n\nAlso clean.`);
  // The pair stays exactly one: a typed token is prose on the DOM round trip, so applying drops it.
  assert.equal(partMarkerStatus(smuggled!).kind, "ready");
  assert.equal(smuggled!.split(PART_START_TOKEN).length - 1, 1);
  assert.equal(partSpanOf(smuggled!)?.span, "Clean prose.\n\nAlso clean.");
});

test("no ready pair: there is nothing to stitch into", () => {
  assert.equal(applyPartRewrite(CHAPTER, "Anything."), null);
  assert.equal(applyPartRewrite(insertPartMarker(CHAPTER, 1, "start"), "Anything."), null);
  assert.equal(applyPartRewrite(`${PART_END_TOKEN}\n\n${PART_START_TOKEN}`, "Anything."), null);
});

test("iteration: apply a rewrite, then apply another one to the recalculated pair", () => {
  const first = applyPartRewrite(marked(1, 3), "First replacement.");
  const second = applyPartRewrite(first!, "Second replacement, longer this time.");
  assert.deepEqual(partSpanOf(second!), {
    before: "# The Storm",
    span: "Second replacement, longer this time.",
    after: "***\n\n> Run,\n> she said.\n\nAfter the storm.",
  });
  assert.equal(partMarkerStatus(second!).kind, "ready");
  // A heading inside the hand-edited replacement stays its own block in the span.
  const third = applyPartRewrite(second!, "## A fresh heading\n\nWith a paragraph.");
  assert.equal(partSpanOf(third!)?.span, "## A fresh heading\n\nWith a paragraph.");
});

// ── The preview's editable region (the gray context stays read-only) ──

/** A render of the synthetic preview chapter: the DOM the editable guard walks. */
function renderPreviewBody(markdown: string): FakeElement {
  const html = markdownToHtml(previewText(markdown));
  return parseHtml(html);
}

function previewText(markdown: string): string {
  return [CONTEXT_BEFORE, PART_START_TOKEN, markdown, PART_END_TOKEN, CONTEXT_AFTER].join("\n\n");
}

const CONTEXT_BEFORE = "Gray before.";
const CONTEXT_AFTER = "Gray after.";

interface FakeNode {
  nodeType: number;
  nodeName: string;
  childNodes: FakeNode[];
  textContent: string | null;
  attributes: Record<string, string>;
  parentNode: FakeNode | null;
  getAttribute(name: string): string | null;
}

interface FakeElement extends FakeNode {
  classList: { contains(name: string): boolean };
  hasAttribute(name: string): boolean;
}

function fakeElement(
  name: string,
  attributes: Record<string, string> = {},
  parent: FakeNode | null = null,
): FakeElement {
  const classes = (attributes.class ?? "").split(/\s+/).filter(Boolean);
  const node: FakeElement = {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: [],
    textContent: null,
    attributes,
    parentNode: parent,
    getAttribute: (attribute: string) => attributes[attribute] ?? null,
    hasAttribute: (attribute: string) => attribute in attributes,
    classList: { contains: (token: string) => classes.includes(token) },
  };
  return node;
}

function fakeText(value: string, parent: FakeNode | null = null): FakeNode {
  return {
    nodeType: 3,
    nodeName: "#text",
    childNodes: [],
    textContent: value,
    attributes: {},
    parentNode: parent,
    getAttribute: () => null,
  };
}

function parseHtml(html: string): FakeElement {
  const body = fakeElement("div", { class: "sw-body" });
  const stack: FakeNode[] = [body];
  const attach = (node: FakeNode) => {
    const top = stack[stack.length - 1]!;
    node.parentNode = top;
    top.childNodes.push(node);
  };
  for (const match of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)>|([^<]+)/gi)) {
    if (match[4] !== undefined) {
      attach(fakeText(match[4]));
      continue;
    }
    if (match[1]) {
      stack.pop();
      continue;
    }
    const attributes: Record<string, string> = {};
    for (const attribute of match[3]?.matchAll(/\s([a-z-]+)="([^"]*)"/gi) ?? [])
      attributes[attribute[1]!] = attribute[2]!;
    const element = fakeElement(match[2]!, attributes);
    attach(element);
    if (match[2] !== "br" && match[2] !== "hr") stack.push(element);
  }
  return body;
}

test("partInSpanBlocks: only the draft's blocks are editable, the gray context never is", () => {
  const body = renderPreviewBody("New first.\n\nNew second.");
  const topLevel = body.childNodes.filter((child) => child.nodeType === 1) as FakeElement[];
  // Gray before, start-bordered draft first, draft second (end border on the last span block), gray after.
  assert.equal(topLevel.length, 4);
  assert.ok(topLevel[1]!.hasAttribute("data-sw-part-start"));
  assert.ok(topLevel[2]!.hasAttribute("data-sw-part-end"));
  // The guard answers for a caret deep inside a block, not only for the block itself.
  assert.equal(partInSpanBlocks(topLevel[0]), false, "gray before");
  assert.equal(partInSpanBlocks(topLevel[3]), false, "gray after");
  assert.equal(partInSpanBlocks(topLevel[1]), true, "start-bordered draft block");
  assert.equal(partInSpanBlocks(topLevel[2]), true, "end-bordered draft block");
  assert.equal(partInSpanBlocks(topLevel[1]!.childNodes[0]!), true, "text inside the draft");
  assert.equal(partInSpanBlocks(topLevel[0]!.childNodes[0]!), false, "text inside the gray context");
  assert.equal(partInSpanBlocks(null), false);
});

test("partInSpanBlocks: a one-block span, and an empty span between the borders", () => {
  const one = renderPreviewBody("Only block.");
  const blocks = one.childNodes.filter((child) => child.nodeType === 1) as FakeElement[];
  assert.equal(blocks.length, 3);
  assert.ok(blocks[1]!.hasAttribute("data-sw-part-start") && blocks[1]!.hasAttribute("data-sw-part-end"));
  assert.equal(partInSpanBlocks(blocks[1]), true);
  assert.equal(partInSpanBlocks(blocks[0]), false);
  assert.equal(partInSpanBlocks(blocks[2]), false);
  // An empty draft renders as one anchor paragraph carrying both borders.
  const empty = renderPreviewBody("");
  const emptyBlocks = empty.childNodes.filter((child) => child.nodeType === 1) as FakeElement[];
  assert.equal(emptyBlocks.length, 3);
  assert.equal(partInSpanBlocks(emptyBlocks[1]), true, "the empty span's anchor paragraph");
});
