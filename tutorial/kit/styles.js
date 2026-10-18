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
      about: 'Like an engineer\'s squared notepad: headings and labels in handwriting, the text in an ordinary book typeface, and lines that wobble a little, as if drawn by hand in ink. Dark: white pen on a slate-grey page.',
      fonts: 'family=Kalam:wght@400;700&family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&family=IBM+Plex+Mono:wght@400;500;600',
      face: '700 16px "Kalam"' },
    { id: 'blueprint', name: 'Blueprint', line: 'Cyanotype, white lines, stencil lettering',
      about: 'Like an architect\'s or engineer\'s plan: a fine grid, a ruled border, a box of details in a corner, and headings in stencil letters. Dark is a real blueprint, white lines on deep blue; light is the same drawing printed blue on pale paper.',
      fonts: 'family=Saira+Stencil+One&family=Barlow:ital,wght@0,400;0,600;0,700;1,400&family=B612+Mono:wght@400;700',
      face: '16px "Saira Stencil One"' },
    { id: 'drafting', name: 'Drafting sheet', line: 'Tracing paper, black ink, one orange-red',
      about: 'Like the drawings in a patent: crisp black lines told apart by their dashes rather than by colour, solids shaded with fine diagonal lines, numbered figures, headings in small capitals and labels like a typewriter\'s, and one colour, orange-red, for light and for the handles you drag. Dark: white ink on charcoal.',
      fonts: 'family=Spectral:ital,wght@0,400;0,600;1,400&family=Spectral+SC:wght@500;600&family=Courier+Prime:wght@400;700',
      face: '600 16px "Spectral SC"' },
    { id: 'riso', name: 'Risograph', line: 'Grainy paper, bright inks, a little out of line',
      about: 'Like a small printed magazine made on a risograph, a printer that lays bright inks one over another, each a little out of line with the last: bold plain headings, a very easy-to-read text face, solids printed as dots. Dark: the same inks on black paper.',
      fonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=DM+Mono:wght@400;500',
      face: '800 16px "Bricolage Grotesque"' },
]
export const DEFAULT_STYLE = 'notebook'
export const styleOf = id => STYLES.find(s => s.id === id) ?? null
