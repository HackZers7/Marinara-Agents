# 02: Rewrite generation — prompt assembly and streaming preview

**What to build:** Entering marker mode shows a side panel with the rewrite instruction field, an "include original text" toggle (default on, with a brief risk note when off), the generate action (disabled until both markers are valid and an instruction is present), and the reset-markers control. Generation reuses the story-writer's existing generation pipeline and model connection: the prompt carries the full existing story context plus the chapter text before the start marker and after the end marker, with the span text itself included only when the toggle is on. The model returns only the span text, streamed token-by-token into a book-format preview window — same pagination, running headers, and flip controls as the reader — showing roughly one page of gray read-only context on each side. The Stop control matches normal generation; an abort discards the preview draft with a notification while the mode and markers stay in place. Marker tokens are stripped from every model-facing text path (chapter generation, rewrite, summarization, timeline) and excluded from text-length limit accounting.

**Blocked by:** 01 — marker mode must exist so a valid marker pair can gate generation.

**Status:** ready-for-agent

- [ ] The mode side panel hosts the instruction field, the include-original toggle (default on), generate, and reset markers, visible together with the book.
- [ ] Generate is disabled until both markers are valid and the instruction is non-empty.
- [ ] The rewrite prompt includes the full existing story context and the chapter text before and after the marked span; the span text is included only when the toggle is on.
- [ ] Turning the toggle off shows a brief risk note about length and factual drift.
- [ ] No model-facing path (chapter generation, rewrite, summary, timeline) ever sends marker tokens, and tokens do not count toward text-length limits.
- [ ] The result streams live into a paginated, book-format preview with running headers and flip controls; the book itself remains untouched.
- [ ] The preview shows roughly one page of gray read-only context on each side of the streaming span.
- [ ] The Stop control matches normal generation; an abort discards the draft with a notification and keeps the mode and markers active.
- [ ] Prompt-builder regression tests cover context assembly, pre/post span inclusion, the include/exclude-original behavior, and token stripping on all paths.
