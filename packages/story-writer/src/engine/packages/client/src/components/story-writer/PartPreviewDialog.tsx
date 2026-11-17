// ──────────────────────────────────────────────
// Story Writer: Rewrite Part preview (the streamed replacement, in the book's own shape)
// ──────────────────────────────────────────────
// Composes the existing reader: one synthetic chapter whose text is the gray context before, the marker pair around
// the streaming draft, and the gray context after. The renderer already hides the tokens, so the reader needs no
// changes to present it; the dialog only adds its chrome, the Stop control and the Escape handling (PromptPeek's
// pattern). The story itself is never touched while the preview is open.
import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Square, X } from "lucide-react";
import type { PartPreview } from "../../hooks/use-story-generation";
import { useNumberFormat } from "./sidebar/fields";
import type { StoryChapter, StoryTheme } from "../../lib/story-writer/model";
import { PART_END_TOKEN, PART_START_TOKEN } from "../../lib/story-writer/part-markers";
import { StoryDocument } from "./StoryDocument";
import { StoryReader } from "./StoryReader";

// Underscore ids never collide with chapter ids; the ghost page is suppressed by reusing the chapter's id.
const PREVIEW_KEY = "__part-preview";

// ponytail: the preview reuses the reader as-is, so the streamed draft is the synthetic chapter's plain Markdown and
// stays read-only (the whole reader is editable={false}); hand editing (ticket 03) will need the draft block exposed
// as an editable region — the draft text is already isolated in PartPreview.draft for that upgrade.

/** The synthetic preview chapter: gray context, the marker pair, the draft between them, gray context. */
function previewChapter(preview: PartPreview): StoryChapter {
  const text = [preview.contextBefore, PART_START_TOKEN, preview.draft, PART_END_TOKEN, preview.contextAfter]
    .filter((part) => part.trim() || part === PART_START_TOKEN || part === PART_END_TOKEN)
    .join("\n\n");
  const now = new Date().toISOString();
  return {
    id: PREVIEW_KEY,
    storyId: "part-preview",
    text,
    summary: "",
    status: "draft",
    request: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function PartPreviewDialog(props: {
  preview: PartPreview;
  /** The run is still streaming: Stop is offered; closing means aborting. */
  streaming: boolean;
  theme: StoryTheme;
  pageAnimation: boolean;
  storyTitle: string;
  storyDetails: string;
  onStop(): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const { preview } = props;
  const titleId = useId();
  const stopRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const formatNumber = useNumberFormat();
  const chapter = previewChapter(preview);

  useEffect(() => {
    (props.streaming ? stopRef : closeRef).current?.focus({ preventScroll: true });
  }, [props.streaming]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Tab") {
      // aria-modal: keep Tab inside the dialog (PromptPeek's wrap-around).
      const stops = Array.from(
        (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button, [href], [tabindex='0']"),
      );
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
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    // While streaming, leaving the preview means stopping the run; after it ends, it just closes.
    if (props.streaming) props.onStop();
    else props.onClose();
  };

  const leave = () => {
    // While streaming, a stray click on the scrim must not throw a running draft away; Stop is the only way out.
    if (!props.streaming) props.onClose();
  };

  return (
    <>
      <div className="sw-scrim sw-part-preview-scrim" data-open="true" aria-hidden="true" onClick={leave} />
      <div
        className="sw-part-preview"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="sw-part-preview-head">
          <h2 id={titleId}>{t("part.preview.title", { number: preview.chapterNumber })}</h2>
          {props.streaming ? (
            <span className="sw-part-preview-words" aria-hidden="true">
              {t("actions.words", { count: preview.words, formatted: formatNumber(preview.words) })}
            </span>
          ) : null}
          {props.streaming ? (
            <button
              ref={stopRef}
              type="button"
              className="sw-icon-button"
              aria-label={t("actions.stop")}
              title={t("actions.stop")}
              onClick={props.onStop}
            >
              <Square size={16} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              ref={closeRef}
              type="button"
              className="sw-icon-button"
              aria-label={t("part.preview.close")}
              title={t("part.preview.close")}
              onClick={props.onClose}
            >
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="sw-part-preview-stage">
          {(() => {
            // The reader the story itself uses: the paginated book/e-book, or the scrolling document.
            const shared = {
              theme: props.theme,
              storyTitle: props.storyTitle,
              storyDetails: props.storyDetails,
              chapters: [chapter],
              generatingChapterId: props.streaming ? PREVIEW_KEY : null,
              ghostChapterId: PREVIEW_KEY,
              editable: false,
              mariImageUrl: "",
              chapterBarHost: null,
              numberOffset: preview.chapterNumber - 1,
              partPreviewActive: true,
              onChapterChange: () => undefined,
              onStartChapter: () => undefined,
            };
            return props.theme === "document" ? (
              <StoryDocument key={PREVIEW_KEY} {...shared} />
            ) : (
              <StoryReader key={PREVIEW_KEY} {...shared} pageAnimation={props.pageAnimation} />
            );
          })()}
        </div>
      </div>
    </>
  );
}
