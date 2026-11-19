import assert from "node:assert/strict";
import test from "node:test";
import {
  PART_END_TOKEN,
  PART_START_TOKEN,
  findStoryPartMarkers,
  hasPartTokens,
  insertPartMarker,
  locatePartMarkers,
  nextPartPlacement,
  partBlockStarts,
  partMarkerStatus,
  removePartMarker,
  stripPartTokens,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/part-markers.ts";

// One chapter with every block kind: heading, paragraphs, a scene break and a blockquote (whose inner "> " gap is not
// a block boundary). Six blocks, so block indices 0..5 are unambiguous.
const CHAPTER = [
  "# The Storm",
  "It was a dark night.",
  "The wind howled.",
  "***",
  "> Run,\n> she said.",
  "After the storm.",
].join("\n\n");

test("partBlockStarts finds the top-level blocks, including quote groups", () => {
  assert.deepEqual(partBlockStarts(CHAPTER), [
    0,
    CHAPTER.indexOf("It was"),
    CHAPTER.indexOf("The wind"),
    CHAPTER.indexOf("***"),
    CHAPTER.indexOf("> Run,"),
    CHAPTER.indexOf("After"),
  ]);
  assert.deepEqual(partBlockStarts(""), []);
  assert.deepEqual(partBlockStarts("one\n\ntwo"), [0, "one\n\n".length]);
  // A quote line closes the paragraph before it without a blank line, as the renderer does.
  assert.deepEqual(partBlockStarts("para\n> quoted"), [0, "para\n".length]);
  // Headings and scene breaks are their own blocks even without a blank line around them.
  assert.deepEqual(partBlockStarts("para\n### Deep\nmore"), [0, "para\n".length, "para\n### Deep\n".length]);
});

test("insertPartMarker places a token line before the clicked block, or after the last one", () => {
  assert.equal(
    insertPartMarker(CHAPTER, 1, "start"),
    `# The Storm\n\n${PART_START_TOKEN}\n\nIt was a dark night.\n\nThe wind howled.\n\n***\n\n> Run,\n> she said.\n\nAfter the storm.`,
  );
  assert.equal(insertPartMarker(CHAPTER, 99, "end"), `${CHAPTER}\n\n${PART_END_TOKEN}`);
  // Clamped to the first block, and a lone token in an empty chapter is still a placement.
  assert.equal(insertPartMarker(CHAPTER, -3, "start"), `${PART_START_TOKEN}\n\n${CHAPTER}`);
  assert.equal(insertPartMarker("", 0, "start"), PART_START_TOKEN);
  // The second marker on an empty chapter keeps the pair's order instead of dropping the first.
  const emptyPair = insertPartMarker(PART_START_TOKEN, 0, "end");
  assert.equal(emptyPair, `${PART_START_TOKEN}\n\n${PART_END_TOKEN}`);
  assert.equal(partMarkerStatus(emptyPair).kind, "ready");
});

test("the placement lifecycle: none → placing → ready, with tokens on both sides of the span", () => {
  assert.equal(partMarkerStatus(CHAPTER).kind, "none");
  let markdown = insertPartMarker(CHAPTER, 1, "start");
  assert.equal(partMarkerStatus(markdown).kind, "placing");
  // Tokens are boundaries, not content: the content blocks the DOM shows are unchanged.
  assert.equal(partBlockStarts(markdown).length, partBlockStarts(CHAPTER).length);
  markdown = insertPartMarker(markdown, 3, "end");
  assert.equal(partMarkerStatus(markdown).kind, "ready");
  assert.ok(markdown.includes(`The wind howled.\n\n${PART_END_TOKEN}\n\n***`));
  assert.deepEqual(locatePartMarkers(markdown), {
    start: markdown.indexOf(PART_START_TOKEN),
    end: markdown.indexOf(PART_END_TOKEN),
  });
  // Re-placing moves the marker and can never cross the pair's other token: still a valid pair, never reversed
  // and never duplicated.
  const reEnd = insertPartMarker(markdown, 0, "end");
  assert.equal(partMarkerStatus(reEnd).kind, "ready");
  assert.equal((reEnd.match(new RegExp(PART_END_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length, 1);
  const reStart = insertPartMarker(reEnd, 5, "start");
  assert.equal(partMarkerStatus(reStart).kind, "ready");
  assert.equal(
    (reStart.match(new RegExp(PART_START_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
    1,
  );
  assert.ok(reStart.indexOf(PART_START_TOKEN) < reStart.indexOf(PART_END_TOKEN));
});

test("invalid pairs: reversed order and duplicated tokens", () => {
  assert.deepEqual(partMarkerStatus(`a\n\n${PART_END_TOKEN}\n\nb\n\n${PART_START_TOKEN}\n\nc`), {
    kind: "invalid",
    reason: "reversed",
  });
  assert.deepEqual(partMarkerStatus(`a\n\n${PART_START_TOKEN}\n\nb\n\n${PART_START_TOKEN}\n\nc\n\n${PART_END_TOKEN}`), {
    kind: "invalid",
    reason: "duplicate",
  });
  assert.deepEqual(partMarkerStatus(`a\n\n${PART_END_TOKEN}\n\nb\n\n${PART_END_TOKEN}`), {
    kind: "invalid",
    reason: "duplicate",
  });
});

test("an end without a start is a re-placeable state, not silent corruption", () => {
  const lone = `a\n\n${PART_END_TOKEN}\n\nb`;
  assert.deepEqual(partMarkerStatus(lone), { kind: "lone-end", end: lone.indexOf(PART_END_TOKEN) });
  // CRLF text is read like LF text.
  assert.equal(partMarkerStatus(`a\r\n\r\n${PART_START_TOKEN}\r\n\r\nb`).kind, "placing");
});

test("a token typed inside a paragraph is prose, not a marker", () => {
  const prose = `He wrote ${PART_START_TOKEN} in the margin.`;
  assert.deepEqual(partMarkerStatus(prose), { kind: "none" });
  assert.deepEqual(locatePartMarkers(prose), { start: null, end: null });
  assert.equal(stripPartTokens(prose), prose);
  assert.equal(hasPartTokens(prose), false);
});

test("removing one role leaves the other; stripping clears both and tidies the blank lines", () => {
  const markdown = insertPartMarker(insertPartMarker(CHAPTER, 1, "start"), 4, "end");
  const started = insertPartMarker(CHAPTER, 1, "start");
  assert.equal(removePartMarker(markdown, "end"), started);
  assert.equal(partMarkerStatus(started).kind, "placing");
  assert.equal(removePartMarker(started, "start"), CHAPTER);
  assert.equal(stripPartTokens(markdown), CHAPTER);
  // Tokens at the very edges leave no blank block behind.
  assert.equal(stripPartTokens(`${PART_START_TOKEN}\n\n${CHAPTER}\n\n${PART_END_TOKEN}`), CHAPTER);
  assert.equal(removePartMarker(`One paragraph.\n\n${PART_END_TOKEN}`, "end"), "One paragraph.");
});

test("findStoryPartMarkers: one pair per story, and a pair split across chapters is invalid", () => {
  const clean = { id: "clean-0001", text: "Just prose." };
  assert.deepEqual(findStoryPartMarkers([clean]), { chapterId: null, status: { kind: "none" } });
  const marked = { id: "marked-0001", text: insertPartMarker(CHAPTER, 1, "start") };
  assert.deepEqual(findStoryPartMarkers([clean, marked]), {
    chapterId: "marked-0001",
    status: { kind: "placing", start: marked.text.indexOf(PART_START_TOKEN) },
  });
  const other = { id: "other-00001", text: `a\n\n${PART_END_TOKEN}\n\nb` };
  assert.deepEqual(findStoryPartMarkers([marked, other]), {
    chapterId: "marked-0001",
    status: { kind: "invalid", reason: "split" },
  });
  const corrupt = { id: "corrupt0001", text: `a\n\n${PART_END_TOKEN}\n\nb` };
  assert.deepEqual(findStoryPartMarkers([corrupt]), {
    chapterId: "corrupt0001",
    status: { kind: "lone-end", end: corrupt.text.indexOf(PART_END_TOKEN) },
  });
});

test("nextPartPlacement plans the role for a marker-mode click, or blocks it with a reason", () => {
  // No start yet: the first click places the start marker in the clicked chapter.
  assert.deepEqual(nextPartPlacement("chapter-one", { chapterId: null, status: { kind: "none" } }), {
    role: "start",
    chapterId: "chapter-one",
  });
  // The pair is complete: nothing is placed until a marker is removed or the pair is cleared.
  assert.deepEqual(
    nextPartPlacement("chapter-one", { chapterId: "chapter-one", status: { kind: "ready", start: 0, end: 10 } }),
    { role: "blocked", reason: "pair-exists" },
  );
  // A lone start: the next click places the end, but only in the same chapter.
  assert.deepEqual(
    nextPartPlacement("chapter-one", { chapterId: "chapter-one", status: { kind: "placing", start: 0 } }),
    { role: "end", chapterId: "chapter-one" },
  );
  assert.deepEqual(
    nextPartPlacement("chapter-two", { chapterId: "chapter-one", status: { kind: "placing", start: 0 } }),
    { role: "blocked", reason: "cross-chapter" },
  );
  // A lone end (its start was removed): the next click re-places the start, in the same chapter.
  assert.deepEqual(
    nextPartPlacement("chapter-one", { chapterId: "chapter-one", status: { kind: "lone-end", end: 4 } }),
    { role: "start", chapterId: "chapter-one" },
  );
  assert.deepEqual(
    nextPartPlacement("chapter-two", { chapterId: "chapter-one", status: { kind: "lone-end", end: 4 } }),
    { role: "blocked", reason: "cross-chapter" },
  );
  // A corrupt pair blocks placement until it is cleared.
  assert.deepEqual(
    nextPartPlacement("chapter-one", { chapterId: "chapter-one", status: { kind: "invalid", reason: "reversed" } }),
    { role: "blocked", reason: "invalid-pair" },
  );
});
