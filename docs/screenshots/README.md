# The README's pictures, and how each one is taken

The top-level README and the site's homepage (`index.html`) show these nine files. They were taken on the user's card
on 2026-10-21, with ShadyTracer 0.71.0, as whole-window screenshots, and turned into JPEG in 0.80.0 (below). To retake
one, keep its name: the README and the homepage show it the moment the new file is in. The homepage gives each
picture's width and height, so a retake of another size is one edit there: `node test/seo.test.mjs` names the file and
the size it now has. A picture added under a new name needs a line in the README.

They have to be taken on a real graphics card: the software adapter this repository's automated
checks run on cannot start the raytracer.

## Two ways to take one

- **A screenshot** of the window or part of it: Win + Shift + S on Windows (Cmd + Shift + 4 on a
  Mac), saved as JPEG (or as PNG and converted, below). A browser window of about 1920 × 1030 is what the nine were taken at. Crop
  to what the caption talks about if it is cramped.
- **A render**: File › **Save picture…** in the raytracer, **1280 × 720**. It renders offscreen and
  downloads a PNG named with the time it was saved (`render-2026-10-19_14-03-22.png`): convert it
  (below) to the file name below.

**JPEG, under 1 MB each.** The homepage loads them, and git keeps every version of a picture forever. They were PNGs
until 0.80.0, 16.0 MB for the nine; as JPEGs at quality 85 they are 3.6 MB, the largest (hero, builder) about 600 KB
(measured on the conversion). Quality 85 with the default 4:2:0 chroma was compared at 200 % with the PNG on the
builder's tree, its blue icons and grey text: no difference worth the 4:4:4 version's near doubling. The PNGs are
still in git's history; nothing can take them out short of rewriting it. A PNG to put in:

```sh
convert shot.png -strip -sampling-factor 4:2:0 -quality 85 docs/screenshots/hero.jpg
```

`node test/seo.test.mjs` fails a PNG left in this folder, a file over 1 MB, and a picture the README or the homepage
names that is not here.

## The shot list

Each is a screenshot of the whole window. The scene is named as it was in the picture: an example
from the Project panel, or the user's own.

| file | what it shows |
|---|---|
| `hero.jpg` | View › Layout › **Design**. The user's own scene *Lichtsculptuur* (blue and amber light bars, a mirror ball, plaster walls) with the photon map on; the scene cards over the tree; Render settings (Quality, Light sources) and Render stats on the right. |
| `showcase.jpg` | The *Material board* example, its materials listed in the tree; Render settings and Render stats. |
| `surfaces.jpg` | A copy of the *Relief and texture* example in a raking sun; the scene row selected, so Properties shows its unit, radius, tolerance and environment. |
| `lux-view.jpg` | The *LED, lens and screen* example in High quality with the rays on; with the measure tool, an area over the spot and a pin beside it, each read in cd/m² with its error, CCT, Duv and Δu′v′. The drawer at the picture's bottom right shows. |
| `builder.jpg` | The user's own scene *Dichroics* (coated glass plates, flint spheres, a light, a haze box); one plate selected, with the Transform gizmo's handles, the numbers panel at the top right, and its Properties down to its code. |
| `library.jpg` | The **Library** panel in its grid, beside the *Product shot* example with the bottle selected. |
| `optics-rays.jpg` | The user's own scene *LED* (a chip, a silicone dome, gold leads) with the rays icon on, the rays coloured by the light. |
| `optics-analyse.jpg` | View › Layout › **Analyse** on the *RGBW colour mixing* example after a Run of 10 million rays: the map with isolux lines, the profiles, the polar diagram and the result cards; the screen material's properties on the left. |
| `animate.jpg` | View › Layout › **Animate** on the *Glass and liquid* example: three camera tracks keyed in the Timeline, the video's 1920 × 1080 frame over the picture. |

One more file is not the README's: `social.jpg`, the card a shared link to the site shows (`og:image` in
`index.html`), 1200 × 630 as the card wants it. It is the hero cut to that shape, top kept; a new hero is a new card
by the same command:

```sh
convert docs/screenshots/hero.jpg -resize 1200x -gravity north -crop 1200x630+0+0 +repage -strip -quality 85 docs/screenshots/social.jpg
```

Proposed and not taken (the README does not show them): a render of the noise library, the RGBW map
showing CCT beside the Colour mixing tool, and a 3MF export in the slicer.

## Adding them

Put the files in this folder (`docs/screenshots/`) on the branch and push. Or, on GitHub: open this
folder on the branch, **Add file › Upload files**, and commit.
