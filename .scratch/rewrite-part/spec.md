# Spec: Rewrite Part — partial story regeneration in story-writer

Status: ready-for-agent
Source: design interview (grill-me session, 2026-11-17). All decisions below were confirmed by the user unless marked as an accepted assumption.

## Problem Statement

Long stories accumulate spans that miss the mark: a flat scene, an inconsistent detail, a paragraph that contradicts the timeline. The story-writer agent only offers whole-chapter actions — continue the draft or destructively rewrite the entire last chapter. Fixing one bad span means either manually rewriting it by hand or regenerating thousands of surrounding words that were already good, losing them with no way back.

## Solution

A Rewrite Part mode in the story-writer book UI. The user activates the mode, places two persistent markers (start, then end) by clicking in the paginated book text, writes an instruction, and chooses whether the original span is sent to the model. Generation regenerates only the span, streaming into a separate book-format preview window that shows the surrounding context in gray. The user can hand-edit the result, confirm (replacing the span in the chapter), or cancel. Every confirmed replacement and every abandoned draft is recorded in a server-persisted version history of the span, restorable at any time. Markers survive mode exit, app restarts, and are recalculated to wrap the new text after each rewrite.

## User Stories

1. As a story writer, I want a Rewrite Part button in the story action bar, so that I can start partial regeneration without hunting through menus.
2. As a story writer, I want the Rewrite Part button placed next to the existing Rewrite chapter action, so that the two rewrite scopes stay visually grouped.
3. As a story writer, I want clicking Rewrite Part to enter a distinct marker mode, so that clicks in the book place markers instead of moving the caret.
4. As a story writer, I want my first click in marker mode to set the start marker, so that I control where the regenerated span begins.
5. As a story writer, I want my second click to set the end marker, so that I can see the full selected span before generating.
6. As a story writer, I want the end marker to be placeable on a different book page than the start marker, so that spans longer than one page are still selectable in a paginated book flipped by buttons.
7. As a story writer, I want both markers constrained to a single chapter, so that the span stays within one generation and stitching unit.
8. As a story writer, I want clear feedback when I try to place the end marker in a different chapter, so that I understand the constraint without trial and error.
9. As a story writer, I want the markers to persist when I leave and re-enter Rewrite Part mode, so that I don't lose my selection to an accidental mode switch.
10. As a story writer, I want the markers to persist across app restarts, so that a rewrite I planned yesterday is still selected today.
11. As a story writer, I want the markers stored in the chapter text itself as invisible-on-render Markdown tokens, so that they move with the text under manual edits instead of drifting.
12. As a story writer, I want marker tokens never rendered in the book view, so that the reading experience stays clean.
13. As a story writer, I want marker tokens excluded from every request to the model (chapter generation, rewrite, summaries, timeline), so that the model never sees or imitates them.
14. As a story writer, I want marker tokens excluded from text-length limits accounting, so that they never silently eat my chapter budget.
15. As a story writer, I want clicking a placed marker to remove it, so that a misplacement is fixed by click-then-replace.
16. As a story writer, I want a reset button that clears both markers, so that I can start selection over in one action.
17. As a story writer, I want an invalid marker pair (token manually deleted or corrupted) to highlight the surviving marker with a warning and prompt re-placement, so that silent breakage never reaches generation.
18. As a story writer, I want a mode panel with the instruction field, an "include original text" toggle (default on), a generate button, a reset-markers button, and a version history entry point, so that all rewrite controls live in one place.
19. As a story writer, I want the mode panel to be a side panel visible together with the book, so that markers and instruction are on screen at once.
20. As a story writer, I want to write free-form instructions describing what to change, so that the rewrite follows my intent.
21. As a story writer, I want a toggle for sending the original span text to the model (default on), so that I can rewrite with full detail or regenerate freely from context.
22. As a story writer, I want a brief risk note when the toggle is off, so that I understand the model may produce length and factual drift without the original.
23. As a story writer, I want the rewrite prompt to reuse the story-writer generation context (settings, character/persona/lore cards, summaries, timeline, author note, banned phrases), so that regenerated spans stay consistent with normal chapter generation.
24. As a story writer, I want the prompt to include the chapter text before the start marker and after the end marker, so that the model stitches seamlessly on both sides.
25. As a story writer, I want the model to return only the span text, so that stitching into the chapter is deterministic client-side work.
26. As a story writer, I want the result streamed token-by-token into a preview window, so that I see progress the same way as normal generation.
27. As a story writer, I want the preview window to render as a book in the same paginated format with the same page-flip controls and running headers, so that the rewrite reads in context.
28. As a story writer, I want the preview to show roughly a page of gray read-only context before and after the span, so that I can judge flow across the seams.
29. As a story writer, I want the streaming text read-only during generation and editable after it finishes, so that hand edits never race the stream.
30. As a story writer, I want the gray context to stay read-only always, so that the preview can never silently mutate surrounding chapter text.
31. As a story writer, I want the same Stop control as normal generation in the preview, so that aborting feels familiar.
32. As a story writer, I want an aborted generation to discard the preview draft with a notification while keeping the mode and markers, so that an accidental stop doesn't lose my selection.
33. As a story writer, I want a Confirm action that replaces the whole span between the markers with the previewed result, so that applying is all-or-nothing and predictable.
34. As a story writer, I want to hand-edit the result in the preview before confirming, so that small fixes don't need another generation round.
35. As a story writer, I want cancelling the preview with hand edits present to save the draft into version history as an unapplied version, so that my manual polish is never lost.
36. As a story writer, I want cancelling the preview without hand edits to close it silently, so that dismissing a bad generation costs no clicks.
37. As a story writer, I want each confirmed replacement recorded in a version history entry (text before + text after, hand edits included in the same entry), so that the span's evolution is traceable.
38. As a story writer, I want version history persisted on the server, so that it survives app restarts.
39. As a story writer, I want to open version history from the mode panel and preview each entry, so that I can compare past variants.
40. As a story writer, I want a Restore action on any history entry (including unapplied drafts) that applies that text as a new entry, so that restoring never destroys history.
41. As a story writer, I want the markers recalculated after each applied rewrite to wrap the new span text, so that I can immediately iterate on the fresh result.
42. As a story writer, I want the chapter status (draft/complete) unchanged by a partial rewrite, so that finishing state is owned by chapter-level actions only.
43. As a story writer, I want partial rewrite available on any chapter including drafts, so that I can fix a span mid-draft without finishing first.
44. As a story writer, I want deleting a chapter to remove its markers and span version history, so that no orphaned data outlives its chapter.
45. As a story writer, I want the existing destructive Rewrite chapter (full clear) to remove the chapter's markers and its applied/unapplied span versions, so that the two rewrite features never disagree about chapter content.
46. As a story writer, I want one active marker pair per story, so that the mode always has exactly one unambiguous selection.

## Implementation Decisions

- Package: `story-writer` only. No Engine or server API changes for chapter text; the existing chapter save path persists stitched text unchanged.
- New generation mode beside the existing next/continue/rewrite modes in the client generation hook; it reuses the existing raw generation route, streaming events, abort path, and connection selection.
- Prompt assembly is a new builder beside the existing chapter message builder: full existing story context (system sections, cards, summaries, timeline, author note injection, banned phrases, language, formatting) plus the same chapter as user/assistant turns, with the pre-span text and post-span text around an explicit rewrite instruction; the span text itself is included only when the toggle is on. Response contract: span text only.
- Markers are short explicit HTML-comment tokens in the chapter Markdown source (start and end), hidden by the book renderer. They are stripped from every model-facing text path (generation, rewrite, summary, timeline) and excluded from limit accounting.
- Marker placement maps book DOM positions to Markdown offsets via the existing caret/range plumbing; markers land on paragraph boundaries.
- Marker lifecycle: click marker to remove, next click re-places it; reset button clears both; invalid pair (missing/corrupt token) is detected on mode entry and chapter load, with a warning highlight and a re-place prompt. Deleting the chapter or running the existing whole-chapter rewrite clears the pair and the span history.
- After an applied rewrite the markers are recalculated to wrap the replaced text, keeping the mode ready for iteration.
- UI: mode toggle button in the action bar; side panel hosting instruction, include-original toggle (default on, with risk note when off), generate, reset markers, and history entry point; preview window reusing the book reader presentation (pagination, headers, flip controls) with gray read-only context (~1 page each side).
- Preview editing: result read-only while streaming, contentEditable-style hand editing after completion (same edit-to-Markdown serialization as chapter editing); gray context permanently read-only. Confirm applies the whole span; abort keeps mode and markers, discards the draft with a notification.
- Version history: one client document collection per chapter (or per story) on the existing document store, entries hold {textBefore, textAfter, applied flag, timestamps}; confirmed replacement appends an applied entry (hand edits included); cancel-with-edits appends an unapplied entry; restore appends a new entry and never deletes.
- Chapter status is untouched by partial rewrite; the feature works on drafts and complete chapters alike.
- Concurrency: span rewrites reuse the existing per-story serialization on the document store; the optimistic-revision retry path applies.

## Testing Decisions

Good tests assert external behavior of pure modules and the store contract, not component internals. Three seams, all existing; no new seams.

1. Pure-module regression (same style as the existing story-writer prompt and markdown regressions, node:test importing the TypeScript sources directly):
   - rewrite prompt builder: context assembly, pre/post span inclusion, include/exclude original span, marker-token stripping from all model-facing text;
   - marker token utilities: insert, locate, strip, survive-adjacent-edit behavior, invalid-pair detection;
   - stitching: replacing the span between markers in chapter Markdown and recalculating markers to wrap the new text.
2. Store regression (same style as the existing story-writer store regression): version-history document lifecycle — create/append on confirm, append on cancel-with-edits (unapplied), restore-appends, removal with chapter deletion and whole-chapter rewrite.
3. Browser e2e extending the existing story-writer package e2e: enter mode, place both markers (across a page flip), generate against a stub connection, verify preview streaming + gray context, hand-edit, confirm, verify chapter text replaced and markers wrapped; abort path keeps mode and markers.

## Out of Scope

- Spans crossing chapter boundaries (single chapter only in v1).
- Multiple or named marker pairs (one active pair per story).
- Dragging markers (click-to-remove + re-place only).
- Regenerating a selected sub-span inside the preview (explicitly withdrawn during the interview).
- Diff view between versions.
- Changing the existing destructive whole-chapter Rewrite action.
- Server API changes for chapter text (new server-side surface is limited to the version-history document collection).
- Auto-applying banned-phrase or summary side-effects to rewritten spans beyond what the shared context already enforces.

## Further Notes

- The paginated book flips by buttons, so range-drag selection is not the input model; two sequential clicks are.
- Marker tokens living in the chapter Markdown is the user's explicit preference over an external anchor store: anchors drift under manual edits, in-text tokens cannot. The cost — tokens must be stripped on every model-facing path — is centralized in the prompt/token utilities and regression-tested.
- Accepted assumptions from the interview: gray context is approximately one page on each side; the preview reuses reader headers; markers persist across restarts via chapter persistence; the generate button is disabled until both markers are valid and an instruction is present.
- Baseline validation commands per repo docs: `npm run check`, catalog and locale validators, and the story-writer regression/e2e suite; a package version bump requires a CHANGELOG entry.
