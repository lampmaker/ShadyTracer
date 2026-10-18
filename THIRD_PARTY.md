# Third-party code

ShadyTracer is MIT licensed ([`LICENSE`](LICENSE)). These parts of what it ships are someone else's,
each under the MIT licence, whose text follows the list with each copyright line.

| What | Where | Version | Copyright |
|---|---|---|---|
| [dockview](https://github.com/mathuo/dockview) | `lib/dockview/` (vendored; its own `LICENCE.md` beside it) | 8.3.1 | (c) 2021 mathuo |
| [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) | `lib/timeline/mp4-muxer.mjs` (the licence is in the file) | 5.2.1 | (c) 2023 Vanilagy |
| [Tweakpane](https://github.com/cocopon/tweakpane), modified | `lib/guistuff/propertytable/tweakpane-4.0.4.js` (in the GUISTUFF submodule) | 4.0.4 | (c) 2016 cocopon |
| [Heroicons](https://heroicons.com/) SVGs | `lib/guistuff/treeview/icons.js` (in the GUISTUFF submodule) | — | (c) Tailwind Labs, Inc. |

The author's own libraries, separate repositories under MIT and included as git submodules:
[TinyWebGPU](https://github.com/lampmaker/tinywebgpu) (`lib/tinywebgpu/`) and
[GUISTUFF](https://github.com/lampmaker/GUISTUFF) (`lib/guistuff/`).

Not code, but owed: the signed distance functions follow
[Inigo Quilez's articles](https://iquilezles.org/articles/distfunctions/).

Not in the repository: the tutorial's style mockups (`tutorial/kit/page.js`, `STYLES`) load their typefaces from
[Google Fonts](https://fonts.google.com/) when a page is opened, each under the SIL Open Font License. Once a style
is chosen its faces are to be kept in `tutorial/kit/fonts/` and listed here.

## The MIT licence

The text below applies to each entry in the table, with the copyright line given there in place of
the first line.

```
Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
