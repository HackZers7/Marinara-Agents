# 05: Integration e2e and package release

**What to build:** One browser e2e walks the whole feature on the built package against a stub connection: enter Rewrite Part mode, place both markers across a page flip, generate, watch the preview stream with gray context, hand-edit the result, confirm, verify the chapter text is replaced and the markers wrap the new span, then restore an earlier version from history. Finish with the package release chores: rebuild the package from sources, run the repo's catalog and locale validation scripts, and add the CHANGELOG entry with the version bump required by the release-notes rules.

**Blocked by:** 04 — the full path including version-history restore must exist before the end-to-end pass can cover it.

**Status:** ready-for-agent

- [ ] A browser e2e covers the full user path: mode entry → marker placement across a page flip → generation on a stub connection → streaming preview with gray context → hand edit → confirm → chapter replaced with markers wrapped → restore from history.
- [ ] The package is rebuilt from sources; generated bundles, artifacts, and catalog entries come from the builder, not hand edits.
- [ ] `npm run check` passes on maintained sources.
- [ ] Catalog lane, locale, catalog, and release-notes validation scripts pass.
- [ ] A CHANGELOG entry for the new package version exists and the version is bumped per the repo's release-notes rules.
