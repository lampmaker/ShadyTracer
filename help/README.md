# `help/` -- the Help panel and its pages

Help › Contents or **F1** opens it. The pages are markdown, readable here on GitHub as well.

| file | what |
|---|---|
| `index.js` | the contents: every page, by track (Start, Modelling and rendering, Optical design, Reference), with its title |
| `start/`, `modelling/`, `optics/` | the pages |
| `reference/` | **made, not written**: `node help/reference.mjs` makes them from the program's lists of shapes, modifiers, material fields, reliefs, coatings and light settings |
| `markdown.js` | the renderer: headings, paragraphs, bold, italic, code, lists, tables, links, images, notes, widgets -- everything escaped first |
| `links.js` | what a link does |
| `panel.js` | the panel: contents, back / forward, search, links, widgets |
| `widgets.js` | live pictures in a page: `sdf`, a 2D distance field and a ray sphere-traced through it |
| `help.css` | its look, in the shell's colours |

## Writing a page

Add the file, then a line in `index.js` with its title, which must be the page's first heading. Links:

| write | does |
|---|---|
| `[text](other.md)`, `[text](../track/other.md#heading)` | another page (works on GitHub too) |
| `[text](example:first-steps.json)` | opens that example, as the Project panel's examples do |
| `[text](cmd:analysis.setup)` | runs a command, as its menu entry does |
| `[text](show:properties)`, `[text](show:menu:Analysis)` | opens a panel and outlines it, or outlines a menu |

A live picture:

````
```widget sdf
mode: blend      (circle, box, union, blend, subtract, shell, repeat)
ray: on          (off: no ray)
```
````

`help/test/coverage.test.mjs` fails on a link that goes nowhere, a page not listed, a title that does not match, a
reference page not made again, and a material field or light setting with no words in `reference.mjs`.

**Why a renderer of our own**: the pages need little, and the panel must not take HTML from a page. Escaping
everything first and then marking up a known set is about 150 lines and easy to check (`markdown.test.mjs`); a
library would be a dependency to vendor, and its own sanitising to trust.

**What is written in a page is checked against the code first**, as everything in this repository: the precision
figures are `lib/pathtracer/PRECISION.md`'s, the blend is `scene_api.js` `csgUnion`'s. A number nobody has measured
is said to be typical, or not said.
