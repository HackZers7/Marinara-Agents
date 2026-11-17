import assert from "node:assert/strict";
import test from "node:test";
import {
  PART_END_TOKEN,
  PART_START_TOKEN,
  insertPartMarker,
  partContextExcerpt,
  partSpanOf,
  type PartSpan,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/part-markers.ts";
import {
  countWords,
  defaultStorySettings,
  type StoryChapter,
  type StorySettings,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/model.ts";
import {
  buildChapterMessages,
  buildRewriteSpanMessages,
  buildSummaryMessages,
  buildTimelineMessages,
  chapterTokenBudget,
  loreScanText,
  planRewriteSpan,
  type PromptCharacter,
  type PromptLoreEntry,
  type PromptSources,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/prompt.ts";

// ── Fixtures ──

function settings(patch: Partial<StorySettings> = {}): StorySettings {
  return { ...defaultStorySettings(), ...patch };
}

function chapter(index: number, patch: Partial<StoryChapter> = {}): StoryChapter {
  return {
    id: `chapter-${index}-0000`,
    storyId: "story-1",
    text: `Chapter ${index} text. The hero walks on.`,
    summary: "",
    status: "complete",
    request: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function character(name: string, patch: Partial<PromptCharacter> = {}): PromptCharacter {
  return {
    name,
    description: "",
    personality: "",
    backstory: "",
    appearance: "",
    scenario: "",
    exampleDialogue: "",
    ...patch,
  };
}

// A chapter whose middle two blocks are the marked span (start before block 2, end after block 3).
const MARKED = "# The Storm\n\nIt was a dark night.\n\nThe wind howled.\n\n***\n\nAfter the storm.";
const MARKED_WITH_PAIR = insertPartMarker(insertPartMarker(MARKED, 2, "start"), 4, "end");
const SPAN: PartSpan = {
  before: "# The Storm\n\nIt was a dark night.",
  span: "The wind howled.\n\n***",
  after: "After the storm.",
};

function markedChapter(): StoryChapter {
  return chapter(2, { text: MARKED_WITH_PAIR, request: "Write the storm." });
}

function rewriteBuild(input: Partial<Parameters<typeof buildRewriteSpanMessages>[0]> = {}) {
  return buildRewriteSpanMessages({
    settings: settings(),
    chapters: [chapter(1), markedChapter()],
    chapter: markedChapter(),
    span: SPAN,
    instruction: "Make the storm scene tenser.",
    includeOriginal: true,
    characters: [],
    personas: [],
    lore: [],
    ...input,
  });
}

// ── The span split ──

test("partSpanOf splits a ready pair into token-free before, span and after", () => {
  assert.deepEqual(partSpanOf(MARKED_WITH_PAIR), SPAN);
  // The pieces carry no tokens and reassemble to the stripped chapter.
  const whole = [SPAN.before, SPAN.span, SPAN.after].join("\n\n");
  assert.ok(!whole.includes(PART_START_TOKEN) && !whole.includes(PART_END_TOKEN));
  assert.equal(whole.includes("The wind howled.") && whole.includes("After the storm."), true);
  // A span at the very start and end of a chapter: empty sides are empty strings.
  const leading = insertPartMarker(insertPartMarker("One.\n\nTwo.\n\nThree.", 0, "start"), 1, "end");
  assert.deepEqual(partSpanOf(leading), { before: "", span: "One.", after: "Two.\n\nThree." });
  // No ready pair: nothing to rewrite.
  assert.equal(partSpanOf(MARKED), null);
  assert.equal(partSpanOf(PART_START_TOKEN), null);
  assert.deepEqual(partSpanOf(`${PART_START_TOKEN}\n\n${PART_END_TOKEN}`), { before: "", span: "", after: "" });
});

test("partContextExcerpt takes roughly one page from one end, on a boundary", () => {
  const page = `${"word ".repeat(40).trim()}\n\n`.repeat(20);
  const head = partContextExcerpt(page, 600, "start");
  const tail = partContextExcerpt(page, 600, "end");
  assert.ok(head.length > 300 && head.length <= 600, `head ${head.length}`);
  assert.ok(tail.length > 300 && tail.length <= 600, `tail ${tail.length}`);
  assert.ok(head.endsWith("…") && !head.endsWith(" \n…"), "the head cut is marked");
  assert.ok(tail.startsWith("…"), "the tail cut is marked");
  assert.ok(head.startsWith(page.slice(0, 20)));
  assert.ok(tail.endsWith(page.slice(-20)));
  // Short text passes through whole, and a no-space cut still lands on a boundary.
  assert.equal(partContextExcerpt("Short text.", 600, "start"), "Short text.");
  assert.ok(partContextExcerpt("x".repeat(2_000), 100, "start").length <= 101);
});

// ── The rewrite prompt ──

test("the rewrite prompt carries the story context, the chapter around the span, and the instruction", () => {
  const messages = rewriteBuild({
    settings: settings({
      title: "The Long Road",
      overview: "A watchman walks home.",
      notes: "No sewers.",
      language: "English",
    }),
    characters: [character("Vimes", { description: "A tired copper." })],
    personas: [character("Sybil", { personality: "Kind." })],
    lore: [{ name: "City", content: "The river is solid.", order: 1, position: 0 }],
  });
  const [system] = messages;
  assert.equal(system?.role, "system");
  // The same context sections a chapter prompt carries.
  for (const tag of [
    "story_details",
    "story_overview",
    "world_info",
    "characters",
    "story_notes",
    "banned_phrases",
    "language",
    "formatting",
  ]) {
    assert.ok(system!.content.includes(`<${tag}>`), tag);
  }
  assert.match(system!.content, /A watchman walks home\./);
  assert.match(system!.content, /A tired copper\./);
  // History replays the unmarked chapter, then the marked chapter's turn with the span position held by a placeholder.
  const roles = messages.map((message) => message.role);
  assert.deepEqual(roles, ["system", "user", "assistant", "user", "assistant", "user"]);
  assert.equal(messages[1]?.content, "Continue.");
  assert.equal(messages[2]?.content, "Chapter 1 text. The hero walks on.");
  assert.equal(messages[3]?.content, "Write the storm.");
  assert.equal(messages[4]?.content, "# The Storm\n\nIt was a dark night.\n\n[…]\n\nAfter the storm.");
  // The request is the last message: the instruction, and the original part quoted when it is sent.
  const request = messages[5]!.content;
  assert.match(request, /Make the storm scene tenser\./);
  assert.match(request, /The wind howled\./);
  assert.match(request, /<part_before>/);
  assert.match(request, /<part_after>/);
  assert.match(request, /only the new text of the part/i);
});

test("with the original excluded, the request quotes no span and the placeholder stays", () => {
  const messages = rewriteBuild({ includeOriginal: false });
  assert.equal(messages[4]?.content, "# The Storm\n\nIt was a dark night.\n\n[…]\n\nAfter the storm.");
  const request = messages[5]!.content;
  assert.ok(!request.includes("The wind howled."));
  assert.match(request, /Make the storm scene tenser\./);
});

test("the author's note is injected at its depth, like a chapter run", () => {
  const messages = rewriteBuild({ settings: settings({ authorNote: "Make it rain.", authorNoteDepth: 1 }) });
  assert.equal(messages[4]?.content, "Make it rain.");
  assert.equal(messages[5]?.role, "assistant");
  const deep = rewriteBuild({ settings: settings({ authorNote: "Make it rain.", authorNoteDepth: 99 }) });
  assert.equal(deep[1]?.content, "Make it rain.");
});

test("the length section reports the span's size, not a chapter target", () => {
  const system = rewriteBuild()[0]!.content;
  const words = countWords(SPAN.span);
  assert.match(system, new RegExp(`part[^]*about ${words.toLocaleString("en-US")} words`));
  assert.ok(!/Write chapter \d+ at about/.test(system), "no chapter-length request in a span rewrite");
});

// ── Marker tokens never reach the model ──

test("a chapter prompt strips marker tokens from history and partial turns", () => {
  const messages = buildChapterMessages({
    settings: settings({ keepFullChapters: 5 }),
    chapters: [markedChapter()],
    mode: "continue",
    characters: [],
    personas: [],
    lore: [],
  });
  for (const message of messages) {
    assert.ok(!message.content.includes(PART_START_TOKEN), message.role);
    assert.ok(!message.content.includes(PART_END_TOKEN), message.role);
  }
  assert.match(messages[2]!.content, /The wind howled\./);
  assert.ok(!loreScanText(settings(), [markedChapter()], "").includes(PART_START_TOKEN));
});

test("summary and timeline prompts strip marker tokens", () => {
  const summary = buildSummaryMessages({ settings: settings(), chapter: markedChapter(), chapterNumber: 2 });
  assert.ok(!summary[1]!.content.includes(PART_START_TOKEN));
  assert.ok(!summary[1]!.content.includes(PART_END_TOKEN));
  assert.match(summary[1]!.content, /The wind howled\./);
  const timeline = buildTimelineMessages({ settings: settings(), chapters: [markedChapter()] });
  assert.ok(!timeline[1]!.content.includes(PART_START_TOKEN));
  assert.ok(!timeline[1]!.content.includes(PART_END_TOKEN));
});

test("folded history folds token-free text, so limits never count token lines", () => {
  const long = "word ".repeat(2_400);
  const marked = chapter(1, { text: `# T\n\n${PART_START_TOKEN}\n\n${long}${PART_END_TOKEN}` });
  const messages = buildChapterMessages({
    settings: settings({ keepFullChapters: 200 }),
    chapters: Array.from({ length: 160 }, (_, index) =>
      index === 0 ? marked : chapter(index + 1, { text: `${index + 1} ${long}` }),
    ),
    mode: "next",
    characters: [],
    personas: [],
    lore: [],
  });
  for (const message of messages) {
    assert.ok(!message.content.includes(PART_START_TOKEN), message.role);
    assert.ok(message.content.length <= 500_000, message.role);
  }
});

// ── The plan a span run sends ──

function recordingSources() {
  const calls: unknown[] = [];
  const sources: PromptSources = {
    characters: async (ids) => {
      calls.push(["characters", ids]);
      return ids.map((id) => character(`Card ${id}`));
    },
    personas: async (ids) => {
      calls.push(["personas", ids]);
      return [];
    },
    lore: async (ids, scanText) => {
      calls.push(["lore", ids, scanText]);
      return [] as PromptLoreEntry[];
    },
  };
  return { calls, sources };
}

test("planRewriteSpan returns the messages, the span's token budget and a token-free lore scan", async () => {
  const recorded = recordingSources();
  const plan = await planRewriteSpan({
    settings: settings(),
    chapters: [chapter(1), markedChapter()],
    chapter: markedChapter(),
    span: SPAN,
    instruction: "  Make the storm scene tenser.  ",
    includeOriginal: true,
    savedMaxTokens: null,
    sources: recorded.sources,
  });
  assert.equal(plan.chapterNumber, 2);
  assert.equal(plan.request, "Make the storm scene tenser.");
  assert.equal(plan.maxTokens, chapterTokenBudget(countWords(SPAN.span), null));
  assert.deepEqual(
    plan.messages,
    rewriteBuild({
      chapters: [chapter(1), markedChapter()],
      instruction: "Make the storm scene tenser.",
    }),
  );
  const loreCall = recorded.calls.at(-1) as unknown[];
  const scan = loreCall?.[2] as string;
  assert.ok(!scan.includes(PART_START_TOKEN) && !scan.includes(PART_END_TOKEN));
  assert.ok(scan.includes("Make the storm scene tenser."));
});
