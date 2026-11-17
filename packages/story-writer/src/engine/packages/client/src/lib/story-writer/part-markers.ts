// ──────────────────────────────────────────────
// Story Writer: Rewrite Part markers — placement around the token pair in the chapter Markdown
// ──────────────────────────────────────────────
// The tokens themselves live in markdown.ts next to the renderer that hides them; this module is the placement
// layer: block indexing, pair status, insert/remove/strip and the click-to-role plan. Pure string code only, so
// tests and (later) the prompt builder can use it anywhere.

import { PART_END_TOKEN, PART_START_TOKEN, partTokenOfLine, type PartMarkerRole } from "./markdown.ts";

export { PART_END_TOKEN, PART_START_TOKEN };
export type { PartMarkerRole };

/** Normalizes line endings once, so every scan below sees the text the renderer sees. */
function linesOf(markdown: string): Array<{ line: string; start: number }> {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const result: Array<{ line: string; start: number }> = [];
  let offset = 0;
  for (const line of normalized.split("\n")) {
    result.push({ line, start: offset });
    offset += line.length + 1;
  }
  return result;
}

const QUOTE = /^[ \t]{0,3}>\s?/;
const HR = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const HEADING = /^\s{0,3}#{1,3}\s+\S/;

/**
 * Where each of the chapter's top-level content blocks starts: one entry per paragraph, heading, scene break and
 * quote group, in the order markdownToHtml renders them. Marker token lines are boundaries, not content, so the
 * list stays in lockstep with the rendered DOM blocks (the borders ride on the blocks themselves).
 */
export function partBlockStarts(markdown: string): number[] {
  const starts: number[] = [];
  let paragraph: number | null = null;
  let quote: number | null = null;
  // ponytail: a token typed inside a quote group splits the group here, while the renderer shows it as text; markers
  // placed through the UI always border whole blocks. Upgrade: skip token lines while inside a quote group.
  for (const { line, start } of linesOf(markdown)) {
    if (partTokenOfLine(line)) {
      paragraph = null;
      quote = null;
      continue;
    }
    if (!line.trim()) {
      paragraph = null;
      quote = null;
      continue;
    }
    if (QUOTE.test(line)) {
      // A quote line closes the paragraph before it; the group's first line opens the quote block.
      paragraph = null;
      if (quote === null) {
        quote = start;
        starts.push(start);
      }
      continue;
    }
    quote = null;
    // A heading or scene break flushes the paragraph before it, as the renderer does, and is its own block.
    if (HR.test(line) || HEADING.test(line)) {
      paragraph = null;
      starts.push(start);
      continue;
    }
    if (paragraph === null) {
      starts.push(start);
      paragraph = start;
    }
  }
  return starts;
}

export type PartMarkerStatus =
  | { kind: "none" }
  /** The start exists alone: the next click places the end. */
  | { kind: "placing"; start: number }
  /** The end exists alone (its start was removed): the next click re-places the start. */
  | { kind: "lone-end"; end: number }
  | { kind: "ready"; start: number; end: number }
  | { kind: "invalid"; reason: "duplicate" | "reversed" | "split" };

/** Reads the pair out of one chapter: no tokens, one marker awaiting its partner, a valid pair, or a corrupt one. */
export function partMarkerStatus(markdown: string): PartMarkerStatus {
  let start: number | null = null;
  let end: number | null = null;
  for (const { line, start: at } of linesOf(markdown)) {
    const token = partTokenOfLine(line);
    if (!token) continue;
    if (token === "start") {
      if (start !== null) return { kind: "invalid", reason: "duplicate" };
      start = at;
    } else if (end !== null) return { kind: "invalid", reason: "duplicate" };
    else end = at;
  }
  if (start === null && end === null) return { kind: "none" };
  if (start === null && end !== null) return { kind: "lone-end", end };
  if (start !== null && end === null) return { kind: "placing", start };
  if (start !== null && end !== null && end < start) return { kind: "invalid", reason: "reversed" };
  return { kind: "ready", start: start!, end: end! };
}

/** Where each token sits in the chapter Markdown, or null when the token is not on its own line. */
export function locatePartMarkers(markdown: string): { start: number | null; end: number | null } {
  let start: number | null = null;
  let end: number | null = null;
  for (const { line, start: at } of linesOf(markdown)) {
    const token = partTokenOfLine(line);
    if (token === "start" && start === null) start = at;
    else if (token === "end" && end === null) end = at;
  }
  return { start, end };
}

/** True when the chapter holds a marker token on its own line. */
export function hasPartTokens(markdown: string): boolean {
  for (const { line } of linesOf(markdown)) if (partTokenOfLine(line) !== null) return true;
  return false;
}

/**
 * Places the `role` marker before the content block whose index is `blockIndex`, or past the last one when the
 * index is beyond the end. A marker of the same role already present is moved, not duplicated, and placement never
 * crosses the pair's other token: an end lands at or after the start, a start at or before the end.
 */
export function insertPartMarker(markdown: string, blockIndex: number, role: PartMarkerRole): string {
  const token = role === "start" ? PART_START_TOKEN : PART_END_TOKEN;
  // Placing a role that is already placed moves it: remove first, so the indices count plain content blocks.
  const base = removePartMarker(markdown, role);
  const starts = partBlockStarts(base);
  if (starts.length === 0) {
    // An empty chapter (or one holding only tokens): keep the pair in valid order around nothing.
    const otherAt = lineStartOf(base, role === "start" ? PART_END_TOKEN : PART_START_TOKEN);
    if (otherAt === null) return token;
    return role === "start" ? `${token}\n\n${base}` : `${base}\n\n${token}`;
  }
  const otherAt = lineStartOf(base, role === "start" ? PART_END_TOKEN : PART_START_TOKEN);
  let index = Math.max(0, Math.min(blockIndex, starts.length));
  if (otherAt !== null) {
    // Clamp to the partner: inserting before content block `i` puts the token at starts[i] (the text's end when
    // i is past the last block). A start token must land strictly before the end token, an end at it or after.
    const maxStart = countAtOrBefore(starts, otherAt) - 1;
    const minEnd = countAtOrBefore(starts, otherAt);
    if (role === "start") index = Math.min(index, maxStart);
    else index = Math.max(index, minEnd);
  }
  if (index >= starts.length) return tidy(`${base}\n\n${token}`);
  const at = starts[index]!;
  if (at === 0) return tidy(`${token}\n\n${base}`);
  return tidy(`${base.slice(0, at)}\n\n${token}\n\n${base.slice(at)}`);
}

/** How many content blocks start at or before `offset`. */
function countAtOrBefore(starts: number[], offset: number): number {
  let count = 0;
  while (count < starts.length && (starts[count] ?? 0) <= offset) count += 1;
  return count;
}

/** The line start of a marker token standing on its own line, or null. */
function lineStartOf(markdown: string, token: string): number | null {
  for (const { line, start } of linesOf(markdown))
    if (partTokenOfLine(line) === (token === PART_START_TOKEN ? "start" : "end")) return start;
  return null;
}

/** Removes one marker token, wherever it stands; the other, when present, survives. */
export function removePartMarker(markdown: string, role: PartMarkerRole): string {
  const token = role === "start" ? PART_START_TOKEN : PART_END_TOKEN;
  const at = role === "start" ? locatePartMarkers(markdown).start : locatePartMarkers(markdown).end;
  if (at === null) return markdown;
  return tidy(markdown.slice(0, at) + markdown.slice(at + token.length));
}

/** Removes both tokens and the blank lines they leave, returning plain chapter Markdown. */
export function stripPartTokens(markdown: string): string {
  if (!hasPartTokens(markdown)) return markdown;
  return tidy(
    linesOf(markdown)
      .map(({ line }) => line)
      .filter((line) => partTokenOfLine(line) === null)
      .join("\n"),
  );
}

/** Collapses the runs of blank lines an inserted or removed token can leave, and trims the edges. */
function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*\n+/, "")
    .replace(/\n+[ \t]*$/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface StoryPartMarkers {
  /** The chapter holding a token; only one pair lives in a story. */
  chapterId: string | null;
  status: PartMarkerStatus;
}

/**
 * Reads the story's single pair across its chapters. Tokens in more than one chapter cannot be one pair: the first
 * token's chapter keeps its surviving marker, and the split is reported for re-placement.
 */
export function findStoryPartMarkers(chapters: Array<{ id: string; text: string }>): StoryPartMarkers {
  let holder: { id: string; text: string } | null = null;
  let split = false;
  for (const chapter of chapters) {
    if (!hasPartTokens(chapter.text)) continue;
    if (holder === null) holder = chapter;
    else split = true;
  }
  if (!holder) return { chapterId: null, status: { kind: "none" } };
  if (split) return { chapterId: holder.id, status: { kind: "invalid", reason: "split" } };
  return { chapterId: holder.id, status: partMarkerStatus(holder.text) };
}

export type PartPlacement =
  | { role: PartMarkerRole; chapterId: string }
  | { role: "blocked"; reason: "cross-chapter" | "invalid-pair" | "pair-exists" };

/**
 * What a marker-mode click in `clickedChapterId` does next: the missing marker of the open pair, but only inside the
 * pair's chapter — or the first click of a fresh pair when none is open. A complete pair waits for a removal, and a
 * corrupt pair blocks placement until it is cleared.
 */
export function nextPartPlacement(clickedChapterId: string, markers: StoryPartMarkers): PartPlacement {
  if (markers.status.kind === "invalid") return { role: "blocked", reason: "invalid-pair" };
  if (markers.status.kind === "ready") return { role: "blocked", reason: "pair-exists" };
  if (markers.status.kind === "placing" || markers.status.kind === "lone-end") {
    if (markers.chapterId !== null && clickedChapterId !== markers.chapterId) {
      return { role: "blocked", reason: "cross-chapter" };
    }
    return { role: markers.status.kind === "placing" ? "end" : "start", chapterId: clickedChapterId };
  }
  return { role: "start", chapterId: clickedChapterId };
}
