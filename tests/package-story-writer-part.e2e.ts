import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const engineRoot = process.env.MARINARA_ENGINE_ROOT;
if (!engineRoot) throw new Error("Set MARINARA_ENGINE_ROOT to a compatible Engine checkout");
const appVersion = JSON.parse(readFileSync(resolve(engineRoot, "package.json"), "utf8")).version;

const PARAGRAPH =
  "The rain came sideways off the river and found every gap in Vimes's coat. He walked anyway, because walking was " +
  "the job, and because the city had a way of telling you things if you let your boots listen. Somewhere a gutter " +
  "sang *off key*, and somewhere further off a bell decided it was midnight, then thought better of it.";
// Long enough to fill several pages of the book on any screen, so the two markers can sit on different pages.
const CHAPTER = [
  "Thunder rolled over the rooftops.",
  ...Array.from({ length: 14 }, () => PARAGRAPH),
  "***",
  "**Morning came** at last, grey and grudging.",
].join("\n\n");

// The Rewrite Part marker tokens as they persist inside the chapter Markdown (the package's markdown.ts).
const START_TOKEN = "<!--sw:part-start-->";
const END_TOKEN = "<!--sw:part-end-->";
const REWRITE = [
  "The umbrella gave up first, folding inside out like a wounded bird, and Vimes let it go without a fight.",
  "The rain rewrote the street around him, and for once the city spoke plainly: go home, stay dry, and let the night finish what it started.",
].join("\n\n");
const REWRITE_2 = [
  "Somewhere under the city the river remembered every storm it had ever swallowed, and was not impressed by this one.",
  "Vimes walked on through it, coat heavy, hat doing its best to remain philosophical about the whole affair.",
].join("\n\n");
// Typed into the preview by hand after the stream ends: the first draft paragraph keeps it at its end.
const HAND_EDIT = " Hand-polished by the author.";
const EDITED_REWRITE = [REWRITE.split("\n\n")[0]! + HAND_EDIT, ...REWRITE.split("\n\n").slice(1)].join("\n\n");
// Typed into a later rewrite's preview, then left unapplied by closing the preview.
const CANCEL_EDIT = " Saved aside by a cancelled preview.";
const CANCELLED_REWRITE = [REWRITE_2.split("\n\n")[0]! + CANCEL_EDIT, ...REWRITE_2.split("\n\n").slice(1)].join("\n\n");

/** Chapter text with both marker token lines removed and the gaps they leave closed. */
function stripTokens(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== START_TOKEN && line.trim() !== END_TOKEN)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The chapter's marked span split into token-free before/span/after pieces. */
function spanParts(text: string): { before: string; span: string; after: string } {
  const start = text.indexOf(START_TOKEN);
  const end = text.indexOf(END_TOKEN);
  if (start < 0 || end <= start) throw new Error(`markers missing or reversed in: ${text.slice(0, 120)}…`);
  return {
    before: text.slice(0, start).trim(),
    span: text.slice(start + START_TOKEN.length, end).trim(),
    after: text.slice(end + END_TOKEN.length).trim(),
  };
}

function sseBody(content: string) {
  const pieces: string[] = [];
  for (let index = 0; index < content.length; index += 48) pieces.push(content.slice(index, index + 48));
  return [
    { type: "raw_started", data: { runId: "e2e" } },
    ...pieces.map((data) => ({ type: "token", data })),
    { type: "result", data: { content } },
    { type: "done", data: "" },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
}

async function engineRequest(
  request: APIRequestContext,
  baseURL: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
) {
  const response = await request.fetch(`${baseURL}/api${path}`, {
    method,
    data,
    headers: { "x-marinara-csrf": "1", origin: new URL(baseURL).origin },
  });
  expect(response.ok(), `${method} ${path} → ${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}

async function openStoryWriter(page: Page) {
  await page.route("**/api/app-settings/ui", (route) =>
    route.fulfill({ json: route.request().method() === "GET" ? { value: null } : { success: true } }),
  );
  await page.addInitScript((version) => {
    localStorage.removeItem("marinara-active-chat-id");
    localStorage.setItem("marinara:whats-new:seen-version", version);
    localStorage.setItem(
      "marinara-engine-ui",
      JSON.stringify({
        state: { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false, appAccentPulseMode: false },
        version: 65,
      }),
    );
  }, appVersion);
  await page.goto("/");
  await page.getByRole("tab", { name: "Open Story Writer" }).click();
  const root = page.locator("marinara-capability-story-writer .sw-root");
  await expect(root).toBeVisible();
  return root;
}

test("Rewrite Part: markers across a page flip, streamed preview with gray context, hand edit, apply, history, restore, abort", async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  const base = baseURL!;
  const mobile = testInfo.project.name.includes("mobile");

  // A text connection the stream never reaches: /generate/raw is answered below. This file can run beside the other
  // story-writer e2e on the same server, so the connection has its own name and the story pins it: a duplicate
  // "Story Writer E2E" created by whichever test boots first must never decide what this run sends.
  const connections: Array<{ id: string; name: string }> = await engineRequest(request, base, "GET", "/connections");
  const existing = connections.find((row) => row.name === "Rewrite Part E2E");
  const connection = existing
    ? { id: existing.id }
    : {
        id: (
          (await engineRequest(request, base, "POST", "/connections", {
            name: "Rewrite Part E2E",
            provider: "openai",
            baseUrl: "http://127.0.0.1:9/v1",
            apiKey: "story-writer-e2e-key",
            model: "e2e-model",
            isDefault: false,
          })) as { id: string }
        ).id,
      };
  await engineRequest(request, base, "PATCH", "/story-writer/preferences", {
    theme: "book",
    colorMode: "light",
    sidebarSide: "left",
    noteSide: "right",
    streaming: true,
    // Instant page turns: the marker clicks must never race a page-flip animation clone.
    pageAnimation: false,
    showQuickReplies: true,
    quickReplies: [],
  });
  // Each run starts on a fresh story holding one long, complete chapter, so earlier runs never decide what opens.
  // The connection is pinned in the story's own settings; the shared lastStoryId preference is left alone (a
  // parallel story-writer e2e may be racing it on this same server), and the story is picked from the library.
  const fresh = await engineRequest(request, base, "POST", "/story-writer/stories", {
    settings: { title: "A Rewrite Part Story", connectionId: connection.id },
  });
  const storyId = (fresh as { story: { id: string } }).story.id;
  await engineRequest(request, base, "POST", `/story-writer/stories/${storyId}/chapters`, {
    text: CHAPTER,
    status: "complete",
  });
  const seeded = (await engineRequest(request, base, "GET", `/story-writer/stories/${storyId}`)) as {
    chapters: Array<{ id: string }>;
  };
  const chapterId = seeded.chapters[0]!.id;

  const chapter = async (index = 0) =>
    (
      (await engineRequest(request, base, "GET", `/story-writer/stories/${storyId}`)) as {
        chapters: Array<{ text: string; status: string }>;
      }
    ).chapters[index]!;
  const history = async () =>
    (await engineRequest(
      request,
      base,
      "GET",
      `/story-writer/stories/${storyId}/chapters/${chapterId}/part-history`,
    )) as Array<{ textBefore: string; textAfter: string; applied: boolean }>;

  // Every mocked reply the test asks for, in order; `hold` can pause a stream to look at the page mid-flight.
  const replies = [REWRITE, REWRITE_2, REWRITE_2];
  const generations: Array<Record<string, unknown>> = [];
  let hold: Promise<void> | null = null;
  await page.route("**/api/generate/raw", async (route) => {
    generations.push(route.request().postDataJSON());
    await hold;
    const body = replies[Math.min(generations.length - 1, replies.length - 1)]!;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: sseBody(body) });
  });

  const root = await openStoryWriter(page);
  await expect(root).toHaveAttribute("data-sw-theme", "book");
  // lastStoryId is not ours to set (a parallel story-writer e2e may race it), so the story opens from the library.
  // The drawer the library lives in covers the part panel's side of the stage, so it closes again after the pick.
  await root.getByRole("button", { name: "Your stories" }).click();
  await root
    .getByRole("list", { name: "Your stories" })
    .getByRole("button", { name: /A Rewrite Part Story/ })
    .click();
  const hideSettings = root.getByRole("button", { name: "Hide story settings" });
  if (await hideSettings.isVisible()) await hideSettings.click();
  await expect(root.locator(".sw-drawer[data-open='true']")).toHaveCount(0);
  await expect(root.locator(".sw-title-text")).toContainText("A Rewrite Part Story");
  // The seeded chapter fills several pages on both projects; the story opens on its last page.
  const indicator = root.locator(".sw-indicator");
  await expect(indicator).toContainText(/Page \d+ of \d+/);
  expect(Number(/of (\d+)/.exec((await indicator.textContent()) ?? "")?.[1])).toBeGreaterThanOrEqual(mobile ? 3 : 2);

  // Enter Rewrite Part mode from the action bar; the side panel appears beside the book.
  const partButton = root.getByRole("button", { name: "Rewrite a part" });
  await partButton.click();
  await expect(partButton).toHaveAttribute("aria-pressed", "true");
  const panel = root.getByRole("complementary", { name: "Rewrite Part controls" });
  await expect(panel).toBeVisible();
  await expect(root.locator(".sw-reader")).toHaveAttribute("data-sw-part-mode", "true");
  await page.screenshot({ path: testInfo.outputPath("01-part-mode.png") });

  // Start from the chapter's first page: Previous chapter lands on the title spread, which shows the chapter's
  // opening page beside the title on desktop; on a phone the title is a page of its own, so flip once more. Then
  // one more page on both projects: there every paragraph is a full-height middle-of-chapter one, which the mode
  // panel (covering much of the page on a phone) cannot fully hide, and context precedes the span.
  await root.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: "Previous chapter" }).click();
  const next = root.getByRole("button", { name: "Next page" });
  for (let flip = 0; flip < (mobile ? 2 : 1); flip += 1) await next.click();
  await expect(indicator).toContainText("Chapter 1");
  await expect.poll(async () => (await chapter()).text).toBe(CHAPTER);

  /** Clicks the nth paragraph of the current spread (0-based, counting only paragraphs with a clickable fragment).
   * In the paginated book a paragraph fragments across pages, so the click point is one of its client rects — fully
   * on the spread, and where elementFromPoint says the click lands in that paragraph (the mode panel overlays part of
   * the page on a phone). */
  const clickVisibleParagraph = async (n: number) => {
    const point = await root.locator(".sw-viewport").evaluate((viewport, index) => {
      const box = viewport.getBoundingClientRect();
      const clickable: Array<{ x: number; y: number }> = [];
      for (const p of viewport.querySelectorAll<HTMLElement>(".sw-block--chapter .sw-body > p")) {
        let clicked = false;
        for (const r of p.getClientRects()) {
          if (clicked) break;
          // A rect that fills its page's column touches the viewport's edges; keep it, but probe inside it.
          if (r.width <= 40 || r.top < box.top - 1 || r.bottom > box.bottom + 1) continue;
          if (r.left < box.left - 2 || r.right > box.right + 2) continue;
          const xMin = Math.max(r.left + 6, box.left + 6);
          const xMax = Math.min(r.right - 6, box.right - 6);
          const yMin = Math.max(r.top + 6, box.top + 6);
          const yMax = Math.min(r.bottom - 6, box.bottom - 6);
          if (xMax <= xMin || yMax <= yMin) continue;
          // Probe a fine grid; the mode panel can cover most of a phone's column, so scan for any unobstructed
          // point the paragraph itself owns.
          outer: for (let fy = 0.5; fy >= 0.05; fy -= 0.15) {
            for (let fx = 0.97; fx >= 0.03; fx -= 0.15) {
              const x = xMin + (xMax - xMin) * fx;
              const y = yMin + (yMax - yMin) * fy;
              const hit = document.elementFromPoint(x, y);
              if (hit && p.contains(hit)) {
                clickable.push({ x, y });
                clicked = true;
                break outer;
              }
            }
          }
        }
      }
      return { point: clickable[index] ?? null, found: clickable.length };
    }, n);
    if (!point.point)
      throw new Error(
        `no clickable chapter paragraph #${n} on the current spread (found ${point.found} clickable paragraphs)`,
      );
    await page.mouse.click(point.point.x, point.point.y);
  };

  // Place the start marker on the first clickable paragraph of the current spread.
  await clickVisibleParagraph(0);
  await expect(root.locator(".sw-body [data-sw-part-start]")).toHaveCount(1);
  await expect
    .poll(async () => {
      const text = (await chapter()).text;
      return text.includes(START_TOKEN) && !text.includes(END_TOKEN) && stripTokens(text) === CHAPTER;
    })
    .toBe(true);
  // Let the re-measured pagination settle before the flip, so the end marker lands on the new page, not the old.
  await page.waitForTimeout(600);

  // Flip the page with the reader's own control, then place the end marker on the new page.
  const beforeFlip = await indicator.textContent();
  await next.click();
  await expect(indicator).not.toHaveText(beforeFlip ?? "");
  await page.waitForTimeout(300);
  await clickVisibleParagraph(1);
  await expect(root.locator(".sw-body [data-sw-part-end]")).toHaveCount(1);
  await expect
    .poll(async () => {
      const text = (await chapter()).text;
      return text.indexOf(START_TOKEN) < text.indexOf(END_TOKEN) && stripTokens(text) === CHAPTER;
    })
    .toBe(true);
  const marked = (await chapter()).text;
  const original = spanParts(marked);
  await page.screenshot({ path: testInfo.outputPath("02-markers-placed.png") });

  // The instruction and the include-original toggle (on by default) live in the mode panel.
  await panel.getByLabel("Rewrite instruction").fill("Make this scene tenser; keep the ending.");
  await expect(panel.getByRole("button", { name: "Include the original text" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const generate = panel.getByRole("button", { name: "Generate rewrite" });
  await expect(generate).toBeEnabled();

  // Generate, holding the stream closed to inspect the preview before any text arrives.
  let release = () => {};
  hold = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await generate.click();
  await expect.poll(() => generations.length).toBe(1);
  const body = generations[0]!;
  expect(body.connectionId).toBe(connection.id);
  expect(body.streaming).toBe(true);
  const messages = body.messages as Array<{ role: string; content: string }>;
  expect(messages[0]!.role).toBe("system");
  expect(messages[0]!.content).toContain("You are an excellent writer for the user.");
  // No marker token ever reaches the model, on any path.
  expect(JSON.stringify(messages)).not.toContain("sw:part-");
  // The marked chapter replays as an assistant turn with the span held by a placeholder…
  expect(messages.slice(-3, -1)).toEqual([
    { role: "user", content: "Continue." },
    { role: "assistant", content: [original.before, "[…]", original.after].join("\n\n") },
  ]);
  // …and the final request quotes the span itself plus the context on both sides, per the toggle.
  const request1 = messages.at(-1)!.content;
  expect(messages.at(-1)!.role).toBe("user");
  expect(request1).toContain(`<part_before>\n${original.before}\n</part_before>`);
  expect(request1).toContain(`<part>\n${original.span}\n</part>`);
  expect(request1).toContain(`<part_after>\n${original.after}\n</part_after>`);
  expect(request1).toContain("Make this scene tenser; keep the ending.");
  expect(request1).toContain("Rewrite the part between <part> and </part>.");

  // Mid-stream: the preview dialog shows the replacement in the book's own shape, the gray read-only context, and
  // the same Stop control as a chapter run.
  const preview = root.getByRole("dialog", { name: "Rewriting part of chapter 1" });
  await expect(preview).toBeVisible();
  const previewBody = preview.locator(".sw-viewport .sw-body");
  await expect(previewBody).toContainText("Thunder rolled over the rooftops.");
  const colors = await previewBody.evaluate((body) => {
    const blocks = [...body.children];
    const startAt = blocks.findIndex((block) => block.hasAttribute("data-sw-part-start"));
    return {
      startAt,
      gray: startAt > 0 ? getComputedStyle(blocks[startAt - 1]!).color : null,
      draft: startAt >= 0 ? getComputedStyle(blocks[startAt]!).color : null,
    };
  });
  expect(colors.startAt).toBeGreaterThan(0);
  expect(colors.gray).toBeTruthy();
  expect(colors.draft).toBeTruthy();
  expect(colors.gray).not.toBe(colors.draft);
  await expect(previewBody).toHaveAttribute("aria-readonly", "true");
  expect(await previewBody.evaluate((body) => body.isContentEditable)).toBe(false);
  await expect(preview.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("03-preview-streaming.png") });

  // Release the stream; the streamed draft lands, turns editable, and Stop gives way to Apply.
  release();
  hold = null;
  await expect(previewBody).toContainText("The umbrella gave up first");
  await expect(preview.getByRole("button", { name: "Apply the rewrite to the chapter" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(await previewBody.evaluate((body) => body.isContentEditable)).toBe(true);

  // Hand-edit the draft: the caret goes to the end of the draft's first block (the marker-bordered paragraph), and
  // typing appends there; the gray context stays untouched.
  const focusDraft = async () => {
    await previewBody.evaluate((body) => {
      const start = [...body.children].find((block) => block.hasAttribute("data-sw-part-start")) as HTMLElement;
      const target = start.querySelector("p") ?? start;
      const range = document.createRange();
      range.selectNodeContents(target);
      range.collapse(false);
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      (target.closest(".sw-body") as HTMLElement).focus({ preventScroll: true });
    });
  };
  await focusDraft();
  await page.keyboard.type(HAND_EDIT);
  await expect(previewBody).toContainText("Hand-polished by the author.");
  await page.screenshot({ path: testInfo.outputPath("04-preview-edited.png") });

  // Confirm: the span between the markers is replaced by the edited draft, markers wrapping the new text, and the
  // rest of the chapter — including its status — is untouched.
  await preview.getByRole("button", { name: "Apply the rewrite to the chapter" }).click();
  await expect(preview).toHaveCount(0);
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, START_TOKEN, EDITED_REWRITE, END_TOKEN, original.after].join("\n\n"),
      }),
    );

  // A second rewrite of the fresh span (no hand edits this time) gives the history two distinct versions.
  await generate.click();
  await expect.poll(() => generations.length).toBe(2);
  const request2 = (generations[1]!.messages as Array<{ content: string }>).at(-1)!.content;
  expect(request2).toContain(`<part>\n${EDITED_REWRITE}\n</part>`);
  await expect(preview.getByRole("button", { name: "Apply the rewrite to the chapter" })).toBeVisible();
  await preview.getByRole("button", { name: "Apply the rewrite to the chapter" }).click();
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, START_TOKEN, REWRITE_2, END_TOKEN, original.after].join("\n\n"),
      }),
    );

  // Version history from the mode panel: both entries recorded, newest first.
  await panel.getByRole("button", { name: /Version history/ }).click();
  const historyDialog = root.getByRole("dialog", { name: "Version history — chapter 1" });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.locator(".sw-history-entry")).toHaveCount(2);
  await expect(historyDialog.locator(".sw-history-entry").first()).toContainText("Version 2 · applied");
  await expect(historyDialog.locator(".sw-history-entry").last()).toContainText("Version 1 · applied");
  await historyDialog.locator(".sw-history-entry").last().locator("summary").click();
  await expect(historyDialog.locator(".sw-history-entry-text").last()).toContainText("Hand-polished by the author.");
  await page.screenshot({ path: testInfo.outputPath("05-history.png") });

  // Restore version 1: its text replaces the current span, and the restore is recorded as a new (third) entry.
  await historyDialog.locator(".sw-history-entry").last().getByRole("button", { name: "Restore" }).click();
  await expect(historyDialog).toHaveCount(0);
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, START_TOKEN, EDITED_REWRITE, END_TOKEN, original.after].join("\n\n"),
      }),
    );
  expect(await history()).toEqual([
    expect.objectContaining({ textBefore: original.span, textAfter: EDITED_REWRITE, applied: true }),
    expect.objectContaining({ textBefore: EDITED_REWRITE, textAfter: REWRITE_2, applied: true }),
    expect.objectContaining({ textBefore: REWRITE_2, textAfter: EDITED_REWRITE, applied: true }),
  ]);
  await page.screenshot({ path: testInfo.outputPath("06-restored.png") });

  // The abort path: stopping a rewrite discards the preview draft with a notification, while the mode and the
  // markers stay exactly where they were, and history does not grow.
  release = () => {};
  hold = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await generate.click();
  await expect.poll(() => generations.length).toBe(3);
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Rewrite stopped" })).toBeVisible();
  await expect(partButton).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toBeVisible();
  await expect(root.locator(".sw-body [data-sw-part-start]")).toHaveCount(1);
  await expect(root.locator(".sw-body [data-sw-part-end]")).toHaveCount(1);
  release();
  hold = null;
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, START_TOKEN, EDITED_REWRITE, END_TOKEN, original.after].join("\n\n"),
      }),
    );
  expect(await history()).toHaveLength(3);

  // Cancel with hand edits: closing the preview without Apply saves the edited draft as an unapplied version and
  // leaves the chapter alone.
  hold = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await generate.click();
  await expect.poll(() => generations.length).toBe(4);
  await expect(preview).toBeVisible();
  release();
  hold = null;
  await expect(previewBody).toContainText("Somewhere under the city the river remembered");
  await expect(preview.getByRole("button", { name: "Apply the rewrite to the chapter" })).toBeVisible();
  await expect(preview.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
  expect(await previewBody.evaluate((body) => body.isContentEditable)).toBe(true);
  await focusDraft();
  await page.keyboard.type(CANCEL_EDIT);
  await preview.getByRole("button", { name: "Close the preview" }).click();
  await expect(preview).toHaveCount(0);
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, START_TOKEN, EDITED_REWRITE, END_TOKEN, original.after].join("\n\n"),
      }),
    );
  expect(await history()).toEqual([
    ...Array.from({ length: 3 }, () => expect.objectContaining({ applied: true })),
    expect.objectContaining({ textBefore: EDITED_REWRITE, textAfter: CANCELLED_REWRITE, applied: false }),
  ]);

  // Confirm with the pair edited away mid-preview: nothing lands, the history stays honest, and a warning tells the
  // author the markers are gone. The start marker is removed the way an edit would lose it — the main chapter body
  // serializes without its bordered block's marker attribute, since the preview owns the screen while it is open.
  hold = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  await generate.click();
  await expect.poll(() => generations.length).toBe(5);
  await expect(preview).toBeVisible();
  release();
  hold = null;
  await expect(preview.getByRole("button", { name: "Apply the rewrite to the chapter" })).toBeVisible();
  await page.evaluate(() => {
    const body = document.querySelector(".sw-reader-slot .sw-block--chapter .sw-body");
    const start = body?.querySelector("[data-sw-part-start]");
    if (body && start) {
      start.removeAttribute("data-sw-part-start");
      body.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  });
  await expect.poll(async () => (await chapter()).text.includes(START_TOKEN)).toBe(false);
  await preview.getByRole("button", { name: "Apply the rewrite to the chapter" }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "markers are gone" })).toBeVisible();
  await expect
    .poll(async () => chapter())
    .toEqual(
      expect.objectContaining({
        status: "complete",
        text: [original.before, EDITED_REWRITE, END_TOKEN, original.after].join("\n\n"),
      }),
    );
  expect(await history()).toHaveLength(4);

  // The destructive whole-chapter rewrite clears the REWRITTEN chapter's history only: a marker pair in an earlier
  // chapter keeps that chapter's versions. The second chapter is added behind the client's back, so a reload shows
  // it to the view before the rewrite runs.
  await engineRequest(request, base, "POST", `/story-writer/stories/${storyId}/chapters`, {
    text: "A short second chapter, complete on arrival.",
    status: "complete",
  });
  const seededAgain = (await engineRequest(request, base, "GET", `/story-writer/stories/${storyId}`)) as {
    chapters: Array<{ id: string }>;
  };
  const secondId = seededAgain.chapters[1]!.id;
  const secondHistory = async () =>
    (await engineRequest(
      request,
      base,
      "GET",
      `/story-writer/stories/${storyId}/chapters/${secondId}/part-history`,
    )) as Array<{ applied: boolean }>;
  await page.reload();
  // A reload opens on the Home tab; Story Writer comes back with the same story (the view remembers it).
  await page.getByRole("tab", { name: "Open Story Writer" }).click();
  await expect(root).toBeVisible();
  await root.getByRole("button", { name: "Rewrite the last chapter" }).click();
  await page.getByRole("button", { name: "Rewrite", exact: true }).click();
  await expect.poll(async () => (await chapter(1)).text).toBe(REWRITE_2);
  expect(await history()).toHaveLength(4);
  expect(await secondHistory()).toEqual([]);

  // An invalid pair is announced on chapter load too, before any mode is entered: the pair is corrupted through the
  // API, a reload makes the view read it, and the warning toast greets the author outside part mode.
  await engineRequest(request, base, "PATCH", `/story-writer/stories/${storyId}/chapters/${chapterId}`, {
    text: [original.before, START_TOKEN, START_TOKEN, END_TOKEN, original.after].join("\n\n"),
  });
  await page.reload();
  await page.getByRole("tab", { name: "Open Story Writer" }).click();
  await expect(root).toBeVisible();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "part marker looks wrong" })).toBeVisible();
  await expect(partButton).toHaveAttribute("aria-pressed", "false");
});
