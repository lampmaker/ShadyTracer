bump: patch

**Pull requests merge into `dev`; a release you run moves `main`.** Every PR used to raise `VERSION` and add the
changelog's top entry itself, and name its version in comments, tests and the tutorial. Two branches in parallel
both took the next number, and the one merged second renumbered all of that by hand (5e068dc, eecc5ce). Now a PR
never picks the number: it adds a change note, `changes/<slug>.md` (a `bump: minor` or `bump: patch` line, then its
entry), and writes the placeholder `0.next` wherever it would name its version. Notes have names of their own and
the placeholder is the same on every branch, so branches no longer conflict over the version.
- **`release.mjs`** (VS Code: Terminal › Run Task › *Release dev → main*, or *Release: dry run*). It works in a
  temporary worktree of `origin`'s `dev`, so the checkout it is run from is never touched:
  - it merges `main` in when `main` has commits `dev` lacks, and stops on a conflict, naming the files;
  - the largest bump among the notes gives the version, and the notes become one changelog entry;
  - the placeholder becomes the number, except in backticks, where it is only its name;
  - a tutorial excerpt is re-stamped only when its stamp held before the number moved it;
  - the notes are deleted, the result is checked as `version.test.mjs` checks it, and it asks before anything is
    pushed;
  - `dev` and `main` are pushed in one atomic push, so both move or neither does.
- **`test/release.test.mjs`** (new): a note that does not parse, or a placeholder with no note, fails the PR that
  brings it, not the release after the merge. It also runs the whole release through real git against a bare
  repository: an upload on main merged in, two notes released as one version, a refused push and a conflict each
  moving nothing.
- **CLAUDE.md**, *Versions* and *Conventions*: the rule. `main` is what Pages serves, and only a release moves it, so
  a merge into `dev` is not deployed.
- **The tutorial:** `tutorial/stamp.mjs`'s `stampPage` takes an optional `should(attrs)`, so the release stamps only
  the excerpts it moved. Its own command stamps as before.

**What to look at:**
- Once `dev` exists (made from `main`) and is the default branch, Terminal › Run Task › *Release: dry run* shows
  the version now and the next patch, with this note and the entry it would write. Nothing is pushed.
- *Release dev → main* asks, then pushes. The Actions tab shows the `pages` run on `main`, and the page's title shows
  ShadyTracer 0.next with main's hash: this note's own version, written as the placeholder.
- If `main`'s protection refuses your push, the release prints GitHub's words, and neither branch has moved.
