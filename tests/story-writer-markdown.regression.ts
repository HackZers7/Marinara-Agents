import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultStorySettings,
  type StoryChapter,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/model.ts";
import {
  htmlToMarkdown,
  markdownToHtml,
  markdownToPlainText,
  type MarkdownNode,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/markdown.ts";
import { countWords } from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/model.ts";
import {
  PART_END_TOKEN,
  PART_START_TOKEN,
  insertPartMarker,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/part-markers.ts";
import {
  storyFileName,
  storyToMarkdown,
  storyToPlainText,
} from "../packages/story-writer/src/engine/packages/client/src/lib/story-writer/export.ts";

interface FakeNode extends MarkdownNode {
  childNodes: FakeNode[];
  attributes: Record<string, string>;
}

function element(
  name: string,
  children: Array<FakeNode | string> = [],
  attributes: Record<string, string> = {},
): FakeNode {
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    childNodes: children.map((child) => (typeof child === "string" ? textNode(child) : child)),
    textContent: null,
    attributes,
    getAttribute: (attribute: string) => attributes[attribute] ?? null,
  };
}

function textNode(value: string): FakeNode {
  return { nodeType: 3, nodeName: "#text", childNodes: [], textContent: value };
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };

/** Just enough of an HTML parser for the tags and attributes markdownToHtml writes. */
function parseHtml(html: string): FakeNode {
  const root = element("div");
  const stack = [root];
  for (const match of html.matchAll(/<(\/?)([a-z0-9]+)((?:\s+[a-z-]+="[^"]*")*)>|([^<]+)/gi)) {
    const top = stack[stack.length - 1];
    if (match[4] !== undefined) {
      top.childNodes.push(textNode(match[4].replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]!)));
      continue;
    }
    if (match[1]) {
      stack.pop();
      continue;
    }
    const name = match[2]!.toLowerCase();
    const attributes: Record<string, string> = {};
    for (const attribute of match[3]?.matchAll(/\s([a-z-]+)="([^"]*)"/gi) ?? []) {
      attributes[attribute[1]!] = attribute[2]!.replace(/&(?:lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity]!);
    }
    const node = element(name, [], attributes);
    top.childNodes.push(node);
    if (name !== "br" && name !== "hr") stack.push(node);
  }
  return root;
}

test("text is escaped before any tag is added, so raw HTML never passes through", () => {
  assert.equal(
    markdownToHtml(`<script>alert("x")</script> & 'q'`),
    "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;</p>",
  );
  const hostile = markdownToHtml('# <img src=x onerror="alert(1)">\n\n> <iframe>\n\n**<b>bold</b>**');
  assert.doesNotMatch(hostile, /<(?:img|iframe|b)[\s>]/);
  assert.equal(
    hostile,
    "<h1>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</h1><blockquote><p>&lt;iframe&gt;</p></blockquote>" +
      "<p><strong>&lt;b&gt;bold&lt;/b&gt;</strong></p>",
  );
});

test("headings, scene breaks, blockquotes and line breaks", () => {
  assert.equal(
    markdownToHtml("# One\n## Two\n### Three ###\n#### Four"),
    "<h1>One</h1><h2>Two</h2><h3>Three</h3><p>#### Four</p>",
  );
  assert.equal(markdownToHtml("#hashtag"), "<p>#hashtag</p>");
  for (const rule of ["***", "---", "* * *", "___", "  - - -  "]) {
    assert.equal(markdownToHtml(`Before\n${rule}\nAfter`), "<p>Before</p><hr><p>After</p>", rule);
  }
  assert.equal(
    markdownToHtml("> quoted\n> more\n>\n> second\n\nafter"),
    "<blockquote><p>quoted<br>more</p><p>second</p></blockquote><p>after</p>",
  );
  assert.equal(markdownToHtml("line one\nline two\r\n\r\n\n\nnext"), "<p>line one<br>line two</p><p>next</p>");
  assert.equal(markdownToHtml(""), "");
});

test("inline bold, italics, underline and strike-through", () => {
  assert.equal(
    markdownToHtml("**bold** *italic* _also_ __under__ ~~gone~~ ***both***"),
    "<p><strong>bold</strong> <em>italic</em> <em>also</em> <u>under</u> <s>gone</s> <strong><em>both</em></strong></p>",
  );
  assert.equal(
    markdownToHtml("**bold with *italic* inside** and *italic with **bold** inside*"),
    "<p><strong>bold with <em>italic</em> inside</strong> and <em>italic with <strong>bold</strong> inside</em></p>",
  );
  // Markers that are not emphasis stay text.
  assert.equal(markdownToHtml("snake_case_name and 2 * 3 * 4"), "<p>snake_case_name and 2 * 3 * 4</p>");
  assert.equal(markdownToHtml("* not a list"), "<p>* not a list</p>");
});

test("htmlToMarkdown round-trips the rendered document", () => {
  const markdown = [
    "# The Storm",
    "It was a *dark* and **stormy** night.\nThe wind __howled__ and ~~whispered~~ roared.",
    "***",
    '> "Run," she said.\n> It was ***too late***.',
    "## Part two",
    "Plain & simple <tags> stay text.",
  ].join("\n\n");
  const html = markdownToHtml(markdown);
  assert.equal(htmlToMarkdown(parseHtml(html)), markdown);
  assert.equal(markdownToHtml(htmlToMarkdown(parseHtml(html))), html);
  // Other scene-break spellings come back as ***.
  assert.equal(htmlToMarkdown(parseHtml(markdownToHtml("a\n\n---\n\nb"))), "a\n\n***\n\nb");
});

test("htmlToMarkdown reads what a contentEditable produces", () => {
  // Typing into an empty editable: a bare text node, then Enter-made blocks, an empty line and a trailing <br>.
  const typed = element("div", [
    "First line",
    element("div", ["Second", element("br")]),
    element("div", [element("br")]),
    element("p", ["Third with", " space", element("br"), "and a break"]),
  ]);
  assert.equal(htmlToMarkdown(typed), "First line\n\nSecond\n\nThird with space\nand a break");
  // Edge spaces move outside the markers and multi-line emphasis is wrapped per line, so both parse back.
  const formatted = element("div", [
    element("p", ["A", element("em", [" spaced "]), "word ", element("b", ["one", element("br"), "two"])]),
    element("h4", ["Deep ", element("i", ["heading"])]),
    element("blockquote", [element("p", ["q1"]), element("p", [element("strike", ["q2"])])]),
    element("hr"),
    element("p", [element("u", [element("strong", ["mixed"])]), element("del", [""])]),
    element("p", ["  ", element("br")]),
  ]);
  assert.equal(
    htmlToMarkdown(formatted),
    "A *spaced* word **one**\n**two**\n\n### Deep *heading*\n\n> q1\n>\n> ~~q2~~\n\n***\n\n__**mixed**__",
  );
  assert.equal(
    markdownToHtml(htmlToMarkdown(formatted)),
    "<p>A <em>spaced</em> word <strong>one</strong><br><strong>two</strong></p><h3>Deep <em>heading</em></h3>" +
      "<blockquote><p>q1</p><p><s>q2</s></p></blockquote><hr><p><u><strong>mixed</strong></u></p>",
  );
});

test("markdownToPlainText drops the markers", () => {
  assert.equal(
    markdownToPlainText("# Title\n\n**Bold** and *it* and __u__ and ~~s~~.\n\n---\n\n> quoted\n\n\n\nend"),
    "Title\n\nBold and it and u and s.\n\n* * *\n\nquoted\n\nend",
  );
});

function exportChapter(index: number, text: string): StoryChapter {
  return {
    id: `chapter-${index}-0000`,
    storyId: "story-1",
    text,
    summary: "",
    status: "complete",
    request: "",
    createdAt: "",
    updatedAt: "",
  };
}

test("exports print the title once and each chapter under its own heading", () => {
  const story = {
    story: {
      id: "story-1",
      settings: { ...defaultStorySettings(), title: "" },
      chapterIds: [],
      wordCount: 0,
      chapterCount: 3,
      createdAt: "",
      updatedAt: "",
    },
    chapters: [
      exportChapter(1, "# The Storm\n\nIt was **dark**."),
      exportChapter(2, "   "),
      exportChapter(3, "No title here."),
    ],
  };
  assert.equal(
    storyToMarkdown(story, "Untitled story"),
    "# Untitled story\n\n## Chapter 1: The Storm\n\nIt was **dark**.\n\n## Chapter 3\n\nNo title here.\n",
  );
  assert.equal(
    storyToPlainText(story, "Untitled story", { chapterLabel: (number) => `Rozdział ${number}` }),
    "Untitled story\n\nRozdział 1: The Storm\n\nIt was dark.\n\nRozdział 3\n\nNo title here.\n",
  );
  assert.equal(storyFileName('Zażółć: "gęślą"/jaźń', "md"), "Zażółć_ _gęślą_jaźń.md");
  assert.equal(storyFileName("  ", "txt"), "story.txt");
});

test("exports never carry Rewrite Part marker tokens out of the story", () => {
  const marked = {
    story: {
      id: "story-1",
      settings: { ...defaultStorySettings(), title: "" },
      chapterIds: [],
      wordCount: 0,
      chapterCount: 1,
      createdAt: "",
      updatedAt: "",
    },
    chapters: [
      exportChapter(
        1,
        "# The Storm\n\nBefore.\n\n<!--sw:part-start-->\n\nThe chosen span.\n\n<!--sw:part-end-->\n\nAfter.",
      ),
    ],
  };
  const markdown = storyToMarkdown(marked, "Untitled story");
  assert.equal(markdown, "# Untitled story\n\n## Chapter 1: The Storm\n\nBefore.\n\nThe chosen span.\n\nAfter.\n");
  assert.ok(!markdown.includes("sw:part"));
  assert.ok(!storyToPlainText(marked, "Untitled story").includes("sw:part"));
});

test("censored words stay literal, and deep quote nesting cannot overflow the stack", () => {
  assert.equal(markdownToHtml('"What the f***?" she asked.'), "<p>&quot;What the f***?&quot; she asked.</p>");
  assert.equal(markdownToPlainText("F*** this."), "F*** this.");
  assert.equal(markdownToHtml("***a*** **b** *c*"), "<p><strong><em>a</em></strong> <strong>b</strong> <em>c</em></p>");
  const deep = `${"> ".repeat(20_000)}deep`;
  const html = markdownToHtml(deep);
  assert.equal(html.match(/<blockquote>/g)?.length, 8);
  assert.ok(html.endsWith("</blockquote>".repeat(8)));
});

// ── Rewrite Part markers ──

/** A marker pair around the chapter's second paragraph, as placement leaves it. */
function markedChapter(): string {
  const chapter = "# The Storm\n\nIt was a dark night.\n\nThe wind howled.\n\n***\n\nAfter.";
  return insertPartMarker(insertPartMarker(chapter, 1, "start"), 3, "end");
}

test("part marker tokens never render, and survive the html round trip with their formatting intact", () => {
  const markdown = markedChapter();
  const html = markdownToHtml(markdown);
  // The literal comment text never reaches the page...
  assert.ok(!html.includes("sw:part"), `no raw token in ${html}`);
  // ...but the bordered paragraphs carry the borders: the span runs from the paragraph the start borders to the
  // paragraph the end borders.
  assert.ok(
    html.includes('<p data-sw-part-start="">It was a dark night.</p><p data-sw-part-end="">The wind howled.</p>'),
    `bordered span paragraphs in ${html}`,
  );
  // Rendering is exactly the stripped chapter's rendering plus the attributes: no text, no extra blocks.
  const strippedHtml = markdownToHtml(stripTokens(markdown));
  assert.equal(html.replace(/ data-sw-part-(?:start|end)=""/g, ""), strippedHtml);
  // The serializer emits the tokens back, so editing around them keeps them in the chapter.
  assert.equal(htmlToMarkdown(parseHtml(html)), markdown);
  assert.equal(markdownToHtml(htmlToMarkdown(parseHtml(html))), html);
  // Manual editing around a marker keeps it: a paragraph typed before the chapter survives serialization, and the
  // token stays on its own line after it.
  const edited = parseHtml(`<p>New opening.</p>${html}`);
  const editedMarkdown = htmlToMarkdown(edited);
  assert.ok(editedMarkdown.startsWith("New opening."));
  assert.ok(editedMarkdown.includes(`# The Storm\n\n${PART_START_TOKEN}\n\nIt was a dark night.`));
  // Inline formatting typed around a token also survives: the token is still a block of its own.
  const formatted = parseHtml(`${html}<p>A <em>styled</em> tail.</p>`);
  assert.ok(
    htmlToMarkdown(formatted).endsWith(`${PART_END_TOKEN}\n\n***\n\nAfter.\n\nA *styled* tail.`),
    `token and formatting kept: ${htmlToMarkdown(formatted)}`,
  );
  // A span bounded by headings and a quote round-trips too: the border rides on any block kind.
  const bounded = `${PART_START_TOKEN}\n\n## Part two\n\n> quoted\n\n${PART_END_TOKEN}`;
  const boundedHtml = markdownToHtml(bounded);
  assert.equal(
    boundedHtml,
    '<h2 data-sw-part-start="">Part two</h2><blockquote data-sw-part-end=""><p>quoted</p></blockquote>',
  );
  assert.equal(htmlToMarkdown(parseHtml(boundedHtml)), bounded);
  // An empty span (the end placed on the same block as the start) keeps its order through the round trip.
  const emptySpan = `# H\n\n${PART_START_TOKEN}\n\n${PART_END_TOKEN}\n\nTail.`;
  const emptyHtml = markdownToHtml(emptySpan);
  assert.equal(emptyHtml, '<h1>H</h1><p data-sw-part-start="" data-sw-part-end=""></p><p>Tail.</p>');
  assert.equal(htmlToMarkdown(parseHtml(emptyHtml)), emptySpan);
});

test("plain text and word counts ignore part marker tokens", () => {
  const markdown = markedChapter();
  assert.equal(markdownToPlainText(markdown), markdownToPlainText(stripTokens(markdown)));
  assert.equal(countWords(markdown), countWords(stripTokens(markdown)));
});

function stripTokens(markdown: string): string {
  return markdown
    .split("\n")
    .filter((line) => line.trim() !== PART_START_TOKEN && line.trim() !== PART_END_TOKEN)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

test("a token-like sequence typed as prose stays escaped text and never becomes an anchor", () => {
  const prose = `He wrote ${PART_START_TOKEN} in the margin.`;
  const html = markdownToHtml(prose);
  assert.ok(!html.includes("data-sw-part"), `no anchor from prose in ${html}`);
  assert.ok(html.includes("&lt;!--sw:part-start--&gt;"), "the raw text is still escaped, not swallowed");
  // Any other HTML comment is still prose: only the exact tokens are ever treated as markers.
  const other = markdownToHtml("<!-- not a marker -->");
  assert.equal(other, "<p>&lt;!-- not a marker --&gt;</p>");
});
