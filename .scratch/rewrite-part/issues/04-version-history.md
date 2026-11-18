# 04: Span version history

**What to build:** A server-persisted version history for the marked span, stored as documents through the existing document store so it survives restarts. Each confirmed replacement appends an applied entry recording the text before and after (hand edits included in the same entry). Cancelling the preview with hand edits appends an unapplied draft entry instead of discarding it (upgrading the interim discard behavior from ticket 03); cancelling without edits still closes silently. The mode panel gains a history entry point listing versions with a preview, and a Restore action on any entry — applied or unapplied — applies that text as a new entry and never deletes anything. Deleting a chapter, and the existing destructive whole-chapter rewrite, remove the chapter's markers and its version history.

**Blocked by:** 03 — history entries are written from the confirm and cancel paths that apply the rewrite.

**Status:** ready-for-agent

- [ ] Version history persists server-side and survives app restarts.
- [ ] Confirm appends an applied entry with the before/after span text; preview hand edits are part of that same entry.
- [ ] Cancelling the preview with hand edits appends an unapplied entry and changes nothing in the chapter text; cancelling without edits closes silently.
- [ ] The history view is reachable from the mode panel and previews each entry.
- [ ] Restore on any entry (applied or unapplied) applies its text as a new appended entry; history is never truncated or deleted by restores.
- [ ] Deleting a chapter removes its markers and its version history.
- [ ] The existing destructive Rewrite chapter clears the chapter's markers and version history.
- [ ] Store regression tests cover the full lifecycle: append on confirm, append on cancel-with-edits, restore-appends, and cleanup on chapter deletion / whole-chapter rewrite.
