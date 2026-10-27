# The README's pictures, and how each one is taken

The top-level README shows these nine files. They were taken on the user's card on 2026-10-21, with
ShadyTracer 0.71.0, as whole-window screenshots. To retake one, keep its name: the README shows it
the moment the new file is in, with no edit. A picture added under a new name needs a line in the
README.

They have to be taken on a real graphics card: the software adapter this repository's automated
checks run on cannot start the raytracer.

## Two ways to take one

- **A screenshot** of the window or part of it: Win + Shift + S on Windows (Cmd + Shift + 4 on a
  Mac), saved as PNG. A browser window of about 1920 × 1030 is what the nine were taken at. Crop
  to what the caption talks about if it is cramped.
- **A render**: File › **Save picture…** in the raytracer, **1280 × 720**. It renders offscreen and
  downloads a PNG named with the time it was saved (`render-2026-10-19_14-03-22.png`): rename it to
  the file name below.

Keep each file under about 2 MB where you can: git keeps every version of a picture forever. Five of
the nine are over it (builder 3.0 MB, surfaces 2.6, hero 2.4, animate 2.2, showcase 2.1); they stay
as they are, since replacing them would add to the history, not shrink it.

## The shot list

Each is a screenshot of the whole window. The scene is named as it was in the picture: an example
from the Project panel, or the user's own.

| file | what it shows |
|---|---|
| `hero.png` | View › Layout › **Design**. The user's own scene *Lichtsculptuur* (blue and amber light bars, a mirror ball, plaster walls) with the photon map on; the scene cards over the tree; Render settings (Quality, Light sources) and Render stats on the right. |
| `showcase.png` | The *Material board* example, its materials listed in the tree; Render settings and Render stats. |
| `surfaces.png` | A copy of the *Relief and texture* example in a raking sun; the scene row selected, so Properties shows its unit, radius, tolerance and environment. |
| `lux-view.png` | The *LED, lens and screen* example in High quality with the rays on; with the measure tool, an area over the spot and a pin beside it, each read in cd/m² with its error, CCT, Duv and Δu′v′. The drawer at the picture's bottom right shows. |
| `builder.png` | The user's own scene *Dichroics* (coated glass plates, flint spheres, a light, a haze box); one plate selected, with the Transform gizmo's handles, the numbers panel at the top right, and its Properties down to its code. |
| `library.png` | The **Library** panel in its grid, beside the *Product shot* example with the bottle selected. |
| `optics-rays.png` | The user's own scene *LED* (a chip, a silicone dome, gold leads) with the rays icon on, the rays coloured by the light. |
| `optics-analyse.png` | View › Layout › **Analyse** on the *RGBW colour mixing* example after a Run of 10 million rays: the map with isolux lines, the profiles, the polar diagram and the result cards; the screen material's properties on the left. |
| `animate.png` | View › Layout › **Animate** on the *Glass and liquid* example: three camera tracks keyed in the Timeline, the video's 1920 × 1080 frame over the picture. |

One more file is not the README's: `social.jpg`, the card a shared link to the site shows (`og:image` in
`index.html`), 1200 × 630 as the card wants it and under 1 MB. It is `hero.png` cut to that shape, top kept; a new
hero is a new card by the same command:

```sh
convert docs/screenshots/hero.png -resize 1200x -gravity north -crop 1200x630+0+0 +repage -strip -quality 85 docs/screenshots/social.jpg
```

Proposed and not taken (the README does not show them): a render of the noise library, the RGBW map
showing CCT beside the Colour mixing tool, and a 3MF export in the slicer.

## Adding them

Put the files in this folder (`docs/screenshots/`) on the branch and push. Or, on GitHub: open this
folder on the branch, **Add file › Upload files**, and commit.
