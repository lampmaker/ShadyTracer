# The README's pictures, and how each one is taken

The top-level README shows these twelve files. A file that is not here yet shows as a broken
image with its caption, so the README can be read before every picture exists, and each one
appears the moment its file is added under the name below. No edit to the README is needed.

They have to be taken on a real graphics card: the software adapter this repository's automated
checks run on cannot start the raytracer.

## Two ways to take one

- **A render**: File › **Save picture…** in the raytracer, **1280 × 720**, the samples given
  below, and the file name below. It renders offscreen and downloads a PNG.
- **A screenshot** of the window or part of it: Win + Shift + S on Windows (Cmd + Shift + 4 on a
  Mac), saved as PNG. A browser window of about 1600 × 900 gives pictures that read well at README
  width. Crop to what the caption talks about.

Keep each file under about 2 MB: a 1280 × 720 render is enough, and git keeps every version of a
picture forever.

## The shot list

| file | kind | how |
|---|---|---|
| `hero.png` | screenshot, whole window | View › Layout › **Design**. *Material showcase* in the tree, converged, one object selected in the picture so its handles show. |
| `showcase.png` | render, 512 samples | *Material showcase*, from a camera you like. |
| `surfaces.png` | render, 512 samples | *Surface materials*. |
| `noise.png` | render, 256 samples | *Noise library* (the slowest scene). |
| `lux-view.png` | screenshot of the picture | *Optics test: LED, lens, screen*. The view icon **lux on surfaces**; with the measure tool, two pins on the screen and one area over the spot. Include the colour legend. |
| `builder.png` | screenshot, whole window | *Builder demo*, Design layout. Select the twisted column in the picture so its handles show, and scroll Properties to its code. |
| `library.png` | screenshot of the Library panel | Grid view, after its pictures have been made. Float the panel larger (⧉ on its group's header) if it is cramped. |
| `optics-rays.png` | screenshot of the picture | *Optics test: LED, lens, screen*. The rays icon on, a few hundred rays, coloured by the light's colour or by the flux left. |
| `optics-analyse.png` | screenshot, whole window | View › Layout › **Analyse**, after ▶ Run on the optics test (a million rays or more): the map with isolux lines, the polar diagram, intensity against angle and the result cards. |
| `colour.png` | screenshot | *RGBW mixer* after a Run: the map showing CCT (or Δu′v′), with Tools › **Colour mixing** open beside it. |
| `print.png` | screenshot of the slicer | Optional. Put an export box around part of a scene, Export 3MF, open it in Bambu Studio, and show the coloured part. |
| `timeline.png` | screenshot, whole window | View › Layout › **Animate**, with two or three tracks keyed (the camera, the sun's elevation) and the export frame visible over the picture. |

## Adding them

Put the files in this folder (`docs/screenshots/`) on the branch and push. Or, on GitHub: open this
folder on the branch, **Add file › Upload files**, and commit.
