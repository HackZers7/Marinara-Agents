# 03: Preview hand edits and applying the rewrite

**What to build:** While generation streams, the previewed span is read-only; once the stream finishes it becomes hand-editable using the same edit-to-Markdown serialization as normal chapter editing. The gray context stays permanently read-only. Confirm replaces the entire span between the markers in the chapter text with the previewed (possibly hand-edited) result, recalculates the markers so they wrap the new text ready for immediate iteration, and leaves the chapter's draft/complete status unchanged. Cancelling the preview without hand edits closes it silently; until version history lands in the next ticket, cancelling with hand edits also simply discards the draft.

**Blocked by:** 02 — the streaming preview must exist before edits and confirmation apply to it.

**Status:** ready-for-agent

- [ ] The streaming span text is read-only during generation and becomes editable once the stream finishes.
- [ ] Hand edits in the preview serialize back to Markdown exactly like manual chapter edits.
- [ ] The gray context blocks are never editable, before or after generation.
- [ ] Confirm replaces the whole span between the markers with the previewed result; the result applies all-or-nothing.
- [ ] After confirmation the markers are recalculated to wrap the replaced text, keeping the mode ready for another iteration.
- [ ] A partial rewrite never changes the chapter's draft/complete status and is available for drafts and complete chapters alike.
- [ ] Cancelling without hand edits closes the preview silently (interim: cancelling with hand edits discards the draft too).
- [ ] Regression tests cover span stitching into chapter Markdown and marker recalculation around the new text.
