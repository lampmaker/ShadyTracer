//======================================================================================================================
// THE STYLES a reader can choose from, by name (the bar's Style menu, page.js; the styles page, tutorial/styles.html).
// Every reader keeps the one they chose (localStorage), and the same pages, figures and code are drawn in each.
//
// TO ADD A STYLE: a file kit/styles/<id>.css that sets every token of kit.css's :root block for light and for dark (copy
// one of the four and change it), its @import at the top of kit.css, and an entry here. The test checks all three agree,
// and pages.check draws every page in every style listed here.
//
//   id      the data-style value and the CSS file's name
//   name    what the menu and the styles page call it
//   line    what it looks like, in a few words
//   about   a sentence for the styles page
//   fonts   its Google Fonts families (css2 query): loaded from Google for now, to be kept in the repository instead
//   face    one of its faces as document.fonts.check takes it, for the browser check to say whether it loaded
//======================================================================================================================

export const STYLES = [
    { id: 'notebook', name: 'Lab notebook', line: 'Squared green paper, fountain pen, red pencil',
      about: 'An engineer\'s pad: headings and figure labels by hand, the text in a book face, lines that wobble a little and are drawn twice like ink. Dark: a slate page and white gel pen.',
      fonts: 'family=Kalam:wght@400;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=IBM+Plex+Mono:wght@400;500;600',
      face: '700 16px "Kalam"' },
    { id: 'blueprint', name: 'Blueprint', line: 'Cyanotype, white lines, stencil lettering',
      about: 'A drawing office: a fine grid, a ruled border, a title block, stencil headings and mono lettering. Dark is a real blueprint, white on Prussian blue; light is a whiteprint, blue-violet on pale paper.',
      fonts: 'family=Saira+Stencil+One&family=Barlow:ital,wght@0,400;0,600;0,700;1,400&family=B612+Mono:wght@400;700',
      face: '16px "Saira Stencil One"' },
    { id: 'drafting', name: 'Drafting sheet', line: 'Vellum, black ink, one vermilion',
      about: 'A patent drawing: crisp lines, hatching, FIG. numbers, a border with zone marks, small-capital headings and typewritten labels, with one spot colour for light. Dark: white ink on charcoal.',
      fonts: 'family=Spectral:ital,wght@0,400;0,600;1,400&family=Spectral+SC:wght@500;600&family=Courier+Prime:wght@400;700',
      face: '600 16px "Spectral SC"' },
    { id: 'riso', name: 'Risograph', line: 'Grainy stock, fluorescent pink and blue',
      about: 'A printed zine: two inks one over the other, a little out of register, bold grotesque headings and a very legible body face, solids printed as dots. Dark: the same inks on black stock.',
      fonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500',
      face: '800 16px "Bricolage Grotesque"' },
]
export const DEFAULT_STYLE = 'notebook'
export const styleOf = id => STYLES.find(s => s.id === id) ?? null
