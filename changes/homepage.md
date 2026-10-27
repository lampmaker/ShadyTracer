bump: minor

**shadytracer.com has a front page, and the app moved to `app.html`.** `/` was the app itself, which told a search
engine little and a new visitor less. It is now a page that says what ShadyTracer is: a button to the app, what it does
with the README's pictures, a section for lighting and optics design, the checks against known answers, the tutorial,
open source, and the questions people ask (what it needs, where work is kept, whether anything is uploaded), with the
README's ✓ and *preview* marks kept. It is static, dark like the app, and works without JavaScript; under its button a
line says whether this browser can run it, asked as the app asks. The app is `app.html` in the same folder, kept out
of search results, with Help › ShadyTracer homepage back to the front page. Projects are kept per site, not per page,
so nothing saved is lost. A link of the old kind, `/?safe` or `/?s=2048`, still opens the app; a shared link's
`?utm_source=` stays on the front page.

**Who makes it, and why**, just under the first picture, short and in the author's words: the lighting industry
(Philips Lighting, Lumileds, Invisua Lighting), Keuper Innovations and code+wood; the ray tracer they always wanted,
started on TinyWebGPU; how it is made -- the foundations by hand, finished with Claude Code under their direction -- and why it can be trusted: what checks it; and what a tip pays for. The bar's About goes there.

**The README's screenshots are JPEGs**, quality 85, under the same names: 16.0 MB for the nine as PNGs, 3.6 MB now,
the largest about 600 KB. The front page shows these same files, so a screenshot retaken is retaken for both.
`docs/screenshots/README.md` gives the command for a new one, and `test/seo.test.mjs` fails a PNG left there, a file
over 1 MB, and a picture whose size the front page no longer gives right.

**What to look at:** shadytracer.com/ shows the front page, and *Open ShadyTracer* opens the app with your projects
as you left them; the app starts as before at `app.html`; Help › ShadyTracer homepage opens the front page in a new
tab; the README's pictures on GitHub look as before. Once released, Search Console's URL inspection of `/` shows the
front page's text.
