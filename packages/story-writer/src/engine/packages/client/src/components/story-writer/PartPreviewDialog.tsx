// ──────────────────────────────────────────────
// Story Writer: Rewrite Part preview (the streamed replacement, in the book's own shape)
// ──────────────────────────────────────────────
// Composes the existing reader: one synthetic chapter whose text is the gray context before, the marker pair around
// the streaming draft, and the gray context after. The renderer already hides the tokens, so the reader needs no
// changes to present it; the dialog only adds its chrome, the Stop control and the Escape handling (PromptPeek's
// pattern). While the run streams the whole reader is read-only; after it ends only the span between the tokens is
// editable — the synthetic chapter is token-free outside the pair, and the serializer emits no token for text the
// author types, so the gray context cannot change. Confirm and Cancel apply or drop the draft; the story itself is
// never touched while the preview is open.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, Square, X } from "lucide-react";
import type { PartPreview } from "../../hooks/use-story-generation";
import { keepTabInside } from "./dialog-keys";
import { useNumberFormat } from "./sidebar/fields";
import { countWords, type StoryChapter, type StoryTheme } from "../../lib/story-writer/model";
import { PART_END_TOKEN, PART_START_TOKEN, partSpanOf } from "../../lib/story-writer/part-markers";
import { partInSpanBlocks } from "./reader-parts";
import { StoryDocument } from "./StoryDocument";
import { StoryReader } from "./StoryReader";

// Underscore ids never collide with chapter ids; the ghost page is suppressed by reusing the chapter's id.
const PREVIEW_KEY = "__part-preview";

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

export interface PartPreviewDialogProps {
  preview: PartPreview;
  /** The run is still streaming: Stop is offered; closing means aborting. */
  streaming: boolean;
  theme: StoryTheme;
  pageAnimation: boolean;
  storyTitle: string;
  storyDetails: string;
  onStop(): void;
  /**
   * Applies the (possibly hand-edited) draft to the chapter and closes the preview. The dialog hands over the draft's
   * current Markdown and whether the author changed it after the stream ended.
   */
  onApply(draft: string, edited: boolean): void;
  /**
   * Closes the preview without applying. Like onApply, the dialog hands over the draft's current Markdown and
   * whether the author changed it after the stream ended, so a cancelled edit can be saved instead of lost.
   */
  onClose(draft: string, edited: boolean): void;
}

export function PartPreviewDialog(props: PartPreviewDialogProps) {
  const { t } = useTranslation();
  const { preview } = props;
  const titleId = useId();
  const stopRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const applyRef = useRef<HTMLButtonElement>(null);
  const formatNumber = useNumberFormat();
  // The draft as the stream produced it: the reference a hand edit is measured against.
  const [streamedDraft, setStreamedDraft] = useState(preview.draft);
  // The draft the reader shows now: the stream moves it while it runs, the author's hand edits move it after.
  const [draft, setDraft] = useState(preview.draft);
  useEffect(() => {
    setDraft(preview.draft);
    setStreamedDraft(preview.draft);
  }, [preview]);
  const edited = !props.streaming && draft.trim() !== streamedDraft.trim();
  const words = props.streaming ? preview.words : countWords(draft);
  const chapter = previewChapter({ ...preview, draft });

  useEffect(() => {
    (props.streaming ? stopRef : applyRef).current?.focus({ preventScroll: true });
  }, [props.streaming]);

  const apply = () => {
    props.onApply(draft, edited);
  };

  // The gray context is read-only by construction: an input or paste can only land in the span's own blocks, the ones
  // the marker borders ride on. A strike anywhere else (a selection reaching past the pair) is cancelled on the native
  // beforeinput event, which is the one that can truly prevent the browser's edit.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const guard = (event: Event) => {
      const input = event as InputEvent;
      const anchor =
        input.getTargetRanges?.()[0]?.startContainer ?? (input.target instanceof Node ? input.target : null);
      if (!partInSpanBlocks(anchor)) event.preventDefault();
    };
    stage.addEventListener("beforeinput", guard, true);
    return () => stage.removeEventListener("beforeinput", guard, true);
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Tab") {
      // aria-modal: keep Tab inside the dialog (PromptPeek's wrap-around).
      keepTabInside(event, event.currentTarget as HTMLElement, "button, [href], [tabindex='0']");
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    // While streaming, leaving the preview means stopping the run; after it ends, it just closes.
    if (props.streaming) props.onStop();
    else props.onClose(draft, edited);
  };

  const leave = () => {
    // While streaming, a stray click on the scrim must not throw a running draft away; Stop is the only way out.
    if (!props.streaming) props.onClose(draft, edited);
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
          <span className="sw-part-preview-words" aria-hidden="true">
            {t("actions.words", { count: words, formatted: formatNumber(words) })}
          </span>
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
            <>
              <button
                ref={applyRef}
                type="button"
                className="sw-button"
                data-variant="primary"
                aria-label={t("part.preview.applyLabel")}
                onClick={apply}
              >
                <Check size={15} aria-hidden="true" />
                {t("part.preview.apply")}
              </button>
              <button
                ref={closeRef}
                type="button"
                className="sw-icon-button"
                aria-label={t("part.preview.close")}
                title={t("part.preview.close")}
                onClick={() => props.onClose(draft, edited)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </>
          )}
        </header>
        <div ref={stageRef} className="sw-part-preview-stage">
          {(() => {
            // The reader the story itself uses: the paginated book/e-book, or the scrolling document.
            const shared = {
              theme: props.theme,
              storyTitle: props.storyTitle,
              storyDetails: props.storyDetails,
              chapters: [chapter],
              generatingChapterId: props.streaming ? PREVIEW_KEY : null,
              ghostChapterId: PREVIEW_KEY,
              // After the stream ends the synthetic chapter turns editable: ChapterBlock keeps its bodies read-only
              // while the (single) generation runs, so during the stream nothing can be typed anywhere.
              editable: !props.streaming,
              mariImageUrl: "",
              chapterBarHost: null,
              numberOffset: preview.chapterNumber - 1,
              partPreviewActive: true,
              // An edit serializes the whole synthetic chapter back to Markdown; the pair still splits it, and only
              // the span between the tokens is the draft the author meant to touch.
              onChapterChange: (_chapterId: string, markdown: string) => {
                setDraft(partSpanOf(markdown)?.span ?? "");
              },
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
