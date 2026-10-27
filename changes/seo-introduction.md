bump: patch

**The site says what it is to a search engine and a shared link.** The page's head has a real title, a description,
its canonical address, an icon, an Open Graph card (`docs/screenshots/social.jpg`, the hero shot cut to 1200 × 630)
and JSON-LD naming it a free web application. `#container` starts with a short introduction -- what ShadyTracer
does, the tutorial and the code linked -- which a crawler reads, since it has no WebGPU, and which is taken away
just before the window is built. A browser without WebGPU, or with WebGPU and no adapter (a headless one, a card
switched off), now stays on that introduction and says why, where the window used to be built and then left without a
picture. `robots.txt` and `sitemap.xml` are new: the sitemap lists
the app and every tutorial page, and each tutorial page has a description, a chapter's its line in the contents.
`test/seo.test.mjs` holds the page, the sitemap, the descriptions and robots.txt together.

**What to look at:** open the page: the introduction shows on the dark background while the modules load, then the
window as before; the tab title is the version as before, the tab icon new. In a browser without WebGPU, or with
hardware acceleration switched off, the introduction stays, with the reason in amber. Once deployed: a link to
shadytracer.com pasted into a chat shows the card, and Google Search Console can be given the sitemap.
