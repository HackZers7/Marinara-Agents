// ──────────────────────────────────────────────
// Story Writer: Rewrite Part mode panel (instruction, include-original toggle, generate, reset)
// ──────────────────────────────────────────────
// The side panel shown beside the book while marker mode is on. Pure props: the view owns the mode, the markers, the
// instruction and the generation; the panel only reports what the author typed and chose, so the instruction survives
// leaving and re-entering the mode.
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Eraser, Sparkles } from "lucide-react";

export interface PartModePanelProps {
  /** Both markers are valid and placed, so generation is meaningful. */
  markersReady: boolean;
  /** Any marker exists (a lone or corrupt pair included), so reset has something to clear. */
  markersPresent: boolean;
  canGenerate: boolean;
  instruction: string;
  includeOriginal: boolean;
  onInstructionChange(value: string): void;
  onIncludeOriginalChange(value: boolean): void;
  onGenerate(): void;
  onReset(): void;
}

/**
 * The Rewrite Part controls: a free-form instruction, the include-original toggle (default on, with a brief risk note
 * when off), the generate button (disabled until the pair is valid and an instruction exists) and the reset control.
 */
export function PartModePanel(props: PartModePanelProps) {
  const { t } = useTranslation();
  const instructionId = useId();
  const disabled = !props.markersReady || !props.instruction.trim() || !props.canGenerate;

  return (
    <aside className="sw-part-panel" aria-label={t("part.panel.label")}>
      <div className="sw-part-panel-head">
        <h2>{t("part.panel.title")}</h2>
        <p className="sw-hint">{t("part.panel.hint")}</p>
      </div>
      <div className="sw-field">
        <label className="sw-label" htmlFor={instructionId}>
          {t("part.instruction")}
        </label>
        <textarea
          id={instructionId}
          className="sw-textarea"
          rows={3}
          value={props.instruction}
          placeholder={t("part.instructionPlaceholder")}
          onChange={(event) => props.onInstructionChange(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="sw-toggle"
        aria-pressed={props.includeOriginal}
        onClick={() => props.onIncludeOriginalChange(!props.includeOriginal)}
      >
        <span className="sw-toggle-text">
          <span>{t("part.includeOriginal")}</span>
          {props.includeOriginal ? <small>{t("part.includeOriginalHint")}</small> : null}
        </span>
        <span className="sw-switch" aria-hidden="true" />
      </button>
      {!props.includeOriginal ? <p className="sw-hint sw-part-risk">{t("part.riskNote")}</p> : null}
      <div className="sw-button-row">
        <button
          type="button"
          className="sw-button"
          data-variant="primary"
          disabled={disabled}
          aria-label={t("part.generate")}
          onClick={props.onGenerate}
        >
          <Sparkles size={15} aria-hidden="true" />
          {t("part.generate")}
        </button>
        <button
          type="button"
          className="sw-button"
          disabled={!props.markersPresent}
          aria-label={t("part.reset")}
          onClick={props.onReset}
        >
          <Eraser size={15} aria-hidden="true" />
          {t("part.reset")}
        </button>
      </div>
    </aside>
  );
}
