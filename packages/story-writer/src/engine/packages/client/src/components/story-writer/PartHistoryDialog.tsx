// ──────────────────────────────────────────────
// Story Writer: Rewrite Part version history (every recorded step of the marked span)
// ──────────────────────────────────────────────
// PromptPeek's dialog pattern: scrim, Escape handling, Tab wrap-around. Each entry previews the text it would
// restore (the draft it produced, hand edits included); Restore applies that text through the same path as a
// confirmed rewrite and records it as a new entry, so restoring never deletes anything.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { History, Loader2, RotateCcw, X } from "lucide-react";
import { countWords, type PartHistoryEntry } from "../../lib/story-writer/model";
import { keepTabInside } from "./dialog-keys";
import { useNumberFormat } from "./sidebar/fields";

function HistoryEntryRow(props: { entry: PartHistoryEntry; index: number; onRestore(index: number): void }) {
  const { t } = useTranslation();
  const formatNumber = useNumberFormat();
  const { entry, index } = props;
  const words = countWords(entry.textAfter);
  return (
    <li className="sw-history-entry">
      <details className="sw-history-fold">
        <summary>
          <span className="sw-history-entry-title">
            {t(entry.applied ? "part.history.entryApplied" : "part.history.entryDraft", { number: index + 1 })}
          </span>
          <span className="sw-history-entry-meta">
            {t("actions.words", { count: words, formatted: formatNumber(words) })}
          </span>
        </summary>
        <div>
          <p className="sw-history-entry-label">{t("part.history.entryPreview")}</p>
          <pre className="sw-history-entry-text">{entry.textAfter}</pre>
        </div>
      </details>
      <button type="button" className="sw-button" onClick={() => props.onRestore(index)}>
        <RotateCcw size={15} aria-hidden="true" />
        {t("part.history.restore")}
      </button>
    </li>
  );
}

export interface PartHistoryDialogProps {
  entries: PartHistoryEntry[];
  isLoading: boolean;
  /** 1-based number of the chapter whose span the history records; 0 when the chapter is gone. */
  chapterNumber: number;
  onRestore(index: number): void;
  onClose(): void;
}

export function PartHistoryDialog(props: PartHistoryDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [newestFirst, setNewestFirst] = useState(true);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Tab") {
      keepTabInside(event, event.currentTarget as HTMLElement, "button, summary, [href], [tabindex='0']");
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };

  const entries = props.entries.map((entry, index) => ({ entry, index }));
  if (newestFirst) entries.reverse();

  return (
    <>
      <div className="sw-scrim sw-history-scrim" data-open="true" aria-hidden="true" onClick={props.onClose} />
      <div
        className="sw-history"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="sw-history-head">
          <h2 id={titleId}>
            {props.chapterNumber > 0
              ? t("part.history.title", { number: props.chapterNumber })
              : t("part.history.titleNoChapter")}
          </h2>
          <button
            type="button"
            className="sw-toggle sw-history-order"
            aria-pressed={newestFirst}
            onClick={() => setNewestFirst((current) => !current)}
          >
            <span>{t("part.history.newestFirst")}</span>
            <span className="sw-switch" aria-hidden="true" />
          </button>
          <button
            ref={closeRef}
            type="button"
            className="sw-icon-button"
            aria-label={t("part.history.close")}
            title={t("part.history.close")}
            onClick={props.onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="sw-history-body" tabIndex={-1}>
          {props.isLoading ? (
            <p className="sw-peek-status" role="status">
              <Loader2 className="sw-spin" size={16} aria-hidden="true" />
              {t("part.history.loading")}
            </p>
          ) : entries.length === 0 ? (
            <p className="sw-peek-status" role="status">
              <History size={16} aria-hidden="true" />
              {t("part.history.empty")}
            </p>
          ) : (
            <ol className="sw-history-list" aria-label={t("part.history.list")}>
              {entries.map(({ entry, index }) => (
                <HistoryEntryRow key={index} entry={entry} index={index} onRestore={props.onRestore} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  );
}
