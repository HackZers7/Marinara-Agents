// ──────────────────────────────────────────────
// Story Writer: the small Markdown dialect the book renders and edits
// ──────────────────────────────────────────────
// No Markdown library may be bundled, and chapter text is model output: every piece of text is escaped before any tag
// is added, so the only HTML that reaches the page is the handful of tags written here.

/** The part of a DOM node the serializer reads, so tests can pass plain objects. */
export interface MarkdownNode {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<MarkdownNode>;
  textContent: string | null;
  /** Real DOM elements have it; marker anchors are recognized through it. */
  getAttribute?(name: string): string | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HEADING = /^\s{0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/;
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

// ── Rewrite Part markers ──

/** The Rewrite Part token that opens the marked span, stored in the chapter Markdown on its own line. */
export const PART_START_TOKEN = "<!--sw:part-start-->";
/** The Rewrite Part token that closes the marked span. */
export const PART_END_TOKEN = "<!--sw:part-end-->";
/** Which end of the marked span a token or pin belongs to. */
export type PartMarkerRole = "start" | "end";

/** The marker a line holds, when the token stands on the line alone; one typed inside prose is prose. */
export function partTokenOfLine(line: string): PartMarkerRole | null {
  const trimmed = line.trim();
  if (trimmed === PART_START_TOKEN) return "start";
  if (trimmed === PART_END_TOKEN) return "end";
  return null;
}

// [pattern, HTML replacement, plain-text replacement]. Order matters: the longer markers go first. Emphasis never starts
// or ends on an asterisk, so a censored "f***" stays literal instead of becoming an empty emphasis.
const INLINE_RULES: Array<[RegExp, string, string]> = [
  [/\*\*\*(?![\s*])(.+?)(?<![\s*])\*\*\*/g, "<strong><em>$1</em></strong>", "$1"],
  [/\*\*(?![\s*])(.+?)(?<![\s*])\*\*/g, "<strong>$1</strong>", "$1"],
  [/(^|[^\p{L}\p{N}_])__(?!\s)(.+?)(?<!\s)__(?![\p{L}\p{N}_])/gu, "$1<u>$2</u>", "$1$2"],
  [/\*(?![\s*])(.+?)(?<![\s*])\*/g, "<em>$1</em>", "$1"],
  [/(^|[^\p{L}\p{N}_])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>", "$1$2"],
  [/~~(?!\s)(.+?)(?<!\s)~~/g, "<s>$1</s>", "$1"],
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

function inlineHtml(text: string): string {
  return INLINE_RULES.reduce((html, [pattern, replacement]) => html.replace(pattern, replacement), escapeHtml(text));
}

function inlinePlain(text: string): string {
  return INLINE_RULES.reduce((plain, [pattern, , replacement]) => plain.replace(pattern, replacement), text);
}

// Deeper "> > >" nesting renders as text: each level recurses, and thousands of them would overflow the stack.
const MAX_QUOTE_DEPTH = 8;

/** Renders chapter Markdown as HTML: paragraphs, h1–h3, scene breaks, blockquotes and inline emphasis. */
export function markdownToHtml(markdown: string, depth = 0): string {
  const html: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] | null = null;
  // Rewrite Part markers ride as attributes on the blocks they border, so the flow of blocks — and with it the
  // pagination and the opening-page CSS — is exactly what it is without the markers.
  let startBefore = false;
  const open = (tag: string) => {
    const marked = startBefore ? tag.replace(">", ` data-sw-part-start="">`) : tag;
    startBefore = false;
    return marked;
  };
  const endAfterLast = () => {
    const last = html[html.length - 1];
    // An end with no block before it: the chapter opens with the end of the span.
    if (last !== undefined) html[html.length - 1] = last.replace(">", ` data-sw-part-end="">`, 1);
    else html.push(`<p data-sw-part-end=""></p>`);
  };
  const flushParagraph = () => {
    if (paragraph.length) html.push(`${open("<p>")}${paragraph.map(inlineHtml).join("<br>")}</p>`);
    // An empty flush keeps a waiting start marker waiting for the next block.
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote) html.push(`${open("<blockquote>")}${markdownToHtml(quote.join("\n"), depth + 1)}</blockquote>`);
    quote = null;
  };

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const quoted = depth < MAX_QUOTE_DEPTH ? QUOTE.exec(line) : null;
    if (quoted) {
      flushParagraph();
      if (!quote) quote = [];
      quote.push(quoted[1] ?? "");
      continue;
    }
    flushQuote();
    const part = depth === 0 ? partTokenOfLine(line) : null;
    if (part) {
      // A Rewrite Part marker line: no prose, only a border on the block before or after it.
      flushParagraph();
      if (part === "start") startBefore = true;
      else {
        // An end directly after its start (an empty span): give the pending start its own anchor first, so
        // the pair keeps its order in the DOM and through the serializer round trip.
        if (startBefore) html.push(`<p data-sw-part-start=""></p>`);
        startBefore = false;
        endAfterLast();
      }
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    if (HR.test(line)) {
      flushParagraph();
      html.push(open("<hr>"));
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1] && heading[2]) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`${open(`<h${level}>`)}${inlineHtml(heading[2])}</h${level}>`);
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushQuote();
  if (startBefore) html.push(`<p data-sw-part-start=""></p>`);
  return html.join("");
}

/** Plain text for the .txt export: markers are removed, scene breaks become "* * *". */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => partTokenOfLine(line) === null)
    .map((line) => {
      if (HR.test(line)) return "* * *";
      const heading = HEADING.exec(line);
      if (heading?.[2]) return inlinePlain(heading[2]);
      return inlinePlain(line.replace(QUOTE, "$1"));
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Editable DOM → Markdown ──

/** The element names the serializer treats as blocks; the DOM-side marker mapping counts the same ones. */
export const MARKDOWN_BLOCK_ELEMENTS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "hr",
  "ul",
  "ol",
  "li",
  "pre",
  "section",
  "article",
]);

const BLOCK_ELEMENTS = MARKDOWN_BLOCK_ELEMENTS;

const INLINE_MARKERS: Record<string, string> = {
  em: "*",
  i: "*",
  strong: "**",
  b: "**",
  u: "__",
  s: "~~",
  strike: "~~",
  del: "~~",
};

/** Wraps each line separately, with edge spaces outside the markers, so the result parses back the same way. */
function wrap(text: string, marker: string): string {
  return text
    .split("\n")
    .map((line) => {
      const [, lead = "", core = "", trail = ""] = /^(\s*)([\s\S]*?)(\s*)$/.exec(line) ?? [];
      return core ? `${lead}${marker}${core}${marker}${trail}` : line;
    })
    .join("\n");
}

function inlineMarkdown(node: MarkdownNode): string {
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? "").replace(/ /g, " ");
  if (node.nodeType !== ELEMENT_NODE) return "";
  const name = node.nodeName.toLowerCase();
  if (name === "br") return "\n";
  const inner = Array.from(node.childNodes, inlineMarkdown).join("");
  const marker = INLINE_MARKERS[name];
  return marker ? wrap(inner, marker) : inner;
}

function blockMarkdown(node: MarkdownNode): string[] {
  const blocks: string[] = [];
  let line = "";
  const flush = () => {
    const text = line.replace(/^\n+/, "").replace(/\s+$/, "");
    if (text.trim()) blocks.push(text);
    line = "";
  };
  for (const child of Array.from(node.childNodes)) {
    const name = child.nodeName.toLowerCase();
    if (child.nodeType !== ELEMENT_NODE || !BLOCK_ELEMENTS.has(name)) {
      line += inlineMarkdown(child);
      continue;
    }
    flush();
    // A Rewrite Part border rides on the block element itself; its token is a block before or after it.
    if (partRoleOfElement(child, "start")) blocks.push(PART_START_TOKEN);
    if (name === "hr") {
      blocks.push("***");
    } else if (/^h[1-6]$/.test(name)) {
      const text = inlineMarkdown(child).replace(/\s+/g, " ").trim();
      if (text) blocks.push(`${"#".repeat(Math.min(3, Number(name[1])))} ${text}`);
    } else if (name === "blockquote") {
      const inner = blockMarkdown(child).join("\n\n");
      if (inner) blocks.push(inner.replace(/^/gm, "> ").replace(/^> $/gm, ">"));
    } else {
      blocks.push(...blockMarkdown(child));
    }
    if (partRoleOfElement(child, "end")) blocks.push(PART_END_TOKEN);
  }
  flush();
  return blocks;
}

/** Whether a rendered block carries the given Rewrite Part border. */
function partRoleOfElement(node: MarkdownNode, role: "start" | "end"): boolean {
  return node.getAttribute?.(`data-sw-part-${role}`) === "";
}

/** Serializes an edited chapter body back to Markdown; empty paragraphs disappear and trailing space is trimmed. */
export function htmlToMarkdown(root: MarkdownNode): string {
  return blockMarkdown(root).join("\n\n").trimEnd();
}
