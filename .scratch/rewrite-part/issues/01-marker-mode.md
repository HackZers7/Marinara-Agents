# 01: Marker mode — marker tokens and placement in the book

**What to build:** A Rewrite Part action next to the existing Rewrite chapter control enters a marker mode. In this mode, clicks in the paginated book place markers instead of moving the caret: the first click sets the start marker, the second the end, including placements on different book pages reached by flipping. Both markers must land inside one chapter; a cross-chapter attempt is rejected with clear feedback. Markers are stored as tokens in the chapter Markdown itself, are never visible in the book rendering, and therefore survive mode exit/re-entry and app restarts. Clicking a placed marker removes it and the next click re-places it; a reset control clears both. A pair invalidated by manual token deletion or corruption is detected when the mode is entered or the chapter loads, highlights the surviving marker with a warning, and prompts re-placement.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Rewrite Part control in the story action bar enters marker mode; existing actions are unchanged.
- [ ] In marker mode, the first book click places the start marker and the second places the end marker; placements on different pages (reached via page-flip buttons) work.
- [ ] Both markers can be placed only within a single chapter; a cross-chapter attempt shows clear feedback and places nothing.
- [ ] Marker tokens embedded in the chapter Markdown are never rendered anywhere in the book view.
- [ ] Markers persist when leaving and re-entering the mode and across app restarts.
- [ ] Clicking a placed marker removes it and the next click re-places it; a reset control clears both markers.
- [ ] An invalid pair (missing or corrupt token after manual editing) is detected on mode entry and chapter load, highlights the surviving marker, and prompts re-placement instead of failing silently.
- [ ] Regression tests cover the marker token utilities (insert, locate, strip, invalid-pair detection) and render-time hiding of the tokens.
