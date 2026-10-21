bump: patch

**0.76.0 left its own version unwritten in seven files, and the release now writes it there.** The group material's
branch named its version as CLAUDE.md shows the placeholder, in backticks, and the release kept every placeholder in
backticks as the placeholder's own name. So FEATURES.md, `builder/model.js` (format 23's comment), three tests, two
headless checks and `tutorial/PLAN.md` still held the placeholder after the release; the run's list of files replaced was the same
sixteen for 0.75.3 as for 0.76.0, which was the sign. They say 0.76.0 now.
- **In backticks, the placeholder is its name only where something is said about it**: CLAUDE.md, CHANGELOG.md and a
  change note (`release.mjs` NAMES). Anywhere else the release makes it the version, backticks and all, and counts it
  as one, so a branch that writes it there and no note is refused as before.
- **CLAUDE.md** says so where it tells a PR to write the placeholder.

**The tutorial:** chapter 25 (Measure first) shows lines of CLAUDE.md this change does not touch, and needed nothing;
no chapter is about the release. `tutorial/PLAN.md` changed only in the version it names.

**What to look at:** nothing in the page. The next `node release.mjs --dry-run` lists every file that names its
version, whichever way it was written.
