# A private repository of ShadyTracer add-ins

This folder is a starting point for a **private** repository. Copy it out of ShadyTracer. Nothing in it is secret. The
add-ins you write into the copy are, as long as the copy stays private. [`docs/ADDINS.md`](../../ADDINS.md) describes
the contract an add-in is written against.

```
your-private-repo/
  ShadyTracer/                  the public repository, as a submodule (recursive: it has two of its own)
  addins/example/index.js       an add-in: copy it, rename its id, make it yours
  addins.json                   the add-ins to load, relative to this file
  .github/workflows/deploy.yml  the public page and these add-ins, behind a login
```

## Making it

```bash
mkdir your-private-repo && cd your-private-repo && git init
```

```bash
git submodule add https://github.com/lampmaker/ShadyTracer.git ShadyTracer
```

```bash
git submodule update --init --recursive
```

Copy `addins/`, `addins.json` and `.github/` from this folder into the new repository. Then create it on GitHub as
a **private** repository and push.

**Never the other way round.** Do not add the private repository to ShadyTracer as a submodule. Its address would
then be in the public repository, and every public clone and CI run would fail to fetch it.

## Running it on your own machine

From the private repository's root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/ShadyTracer/app.html?addins=/addins.json>. The page and the add-ins come from one
server, so nothing has to allow anything. **Help › Add-ins…** shows what loaded and how each one went.

An add-in in the address loads without asking only from the page's own origin or from `localhost`. The page also
keeps a list of its own: add an add-in's URL under **Help › Add-ins…** and it loads at every start in that
browser.

**Revision line:** served this way, the page's version line has no revision. The submodule's `.git` is a file that
points elsewhere, not a folder the page can read, so the line shows the version only.

## Running it for your team, behind a login

`.github/workflows/deploy.yml` copies the public page into one folder at the commit the submodule pins, with
`addins/` and `addins.json` beside it. It then publishes that folder to Cloudflare Pages. Put Cloudflare Access in
front of the site so only the people you name can open it. The workflow's header lists the secrets it needs.

**Why a separate site:** add-ins imported from another origin into shadytracer.com would be fetched without your
login's cookie.

**Do not use GitHub Pages for this.** Outside GitHub Enterprise, a Pages site is public, even when it is built from a
private repository.

**Taking a newer ShadyTracer** means moving the submodule:

```bash
git -C ShadyTracer fetch && git -C ShadyTracer checkout <commit>
```

Then commit and push.

## What stays private, and what does not

- **Hidden from the public:** the source, as long as the repository and the site stay private.
- **Not hidden from your users:** anyone who runs the page can read every module and every shader it loads, in the
  browser's developer tools. Code that must stay hidden from your users too has to run on a server of yours. The
  add-in then calls that server and shows what it returns.
- **ShadyTracer itself is MIT-licensed.** Moving a feature that was already published out of the public repository
  keeps only its further development private. The published version stays MIT, in the history and in every fork.
