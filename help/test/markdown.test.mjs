// node help/test/markdown.test.mjs
//
// THE HELP'S MARKDOWN (help/markdown.js) and its links (help/links.js), no DOM: what each construct becomes, that
// nothing in a page can put HTML into the panel or a link it would not follow, headings' anchors, a widget's block
// read; a link's kind, a page resolved from another's folder, the links found in a page and the ones in code not.
import { renderMarkdown, escapeHtml, slug, safeHref } from '../markdown.js'
import { kindOf, resolve, linksIn } from '../links.js'

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`) }
const html = s => renderMarkdown(s).html

// ---- the constructs
ok('a heading, with its anchor', html('## Combining shapes') === '<h2 id="combining-shapes">Combining shapes</h2>', html('## Combining shapes'))
ok('two headings of one text: their anchors told apart', renderMarkdown('# A\n## A').headings.map(h => h.id).join() === 'a,a-1')
ok('the title is the first heading', renderMarkdown('text\n# Title\n## Sub').title === 'Title')
ok('a paragraph, its lines joined', html('one\ntwo\n\nthree') === '<p>one two</p>\n<p>three</p>', html('one\ntwo\n\nthree'))
ok('bold, italic and code', html('**b** and *i* and `c`') === '<p><strong>b</strong> and <em>i</em> and <code>c</code></p>', html('**b** and *i* and `c`'))
ok('nothing inside code is markup', html('`**not bold**`') === '<p><code>**not bold**</code></p>')
ok('a times sign is not italic', html('2 * 3 * 4') === '<p>2 * 3 * 4</p>', html('2 * 3 * 4'))
ok('a list', html('- a\n- b') === '<ul><li>a</li><li>b</li></ul>')
ok('a numbered list, an item continued on an indented line', html('1. one\n   more\n2. two') === '<ol><li>one more</li><li>two</li></ol>', html('1. one\n   more\n2. two'))
ok('a table', html('| a | b |\n|---|---|\n| 1 | 2 |') === '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
ok('a fenced block, escaped', html('```\n<b>x</b>\n```') === '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>')
ok('a note', html('> careful') === '<blockquote><p>careful</p></blockquote>')
ok('a rule', html('---') === '<hr>')
ok('a link', html('[the page](other.md)') === '<p><a href="other.md">the page</a></p>')
ok('an image', html('![alt](pic.png)') === '<p><img src="pic.png" alt="alt" loading="lazy"></p>')
// a definition (the code reference's functions): a card, the signature's parts marked, the words, its users apart
{
    const d = html('- `Nsphere(p: VEC3, r: f32) -> VEC4` -- A sphere of radius `r`. Used by *sphere*, *dome*.')
    ok('a definition: a card, its signature\'s name, arguments and types marked, the words, "Used by" apart',
        d === '<ul class="help-defs"><li class="help-def"><div class="help-sig"><code><span class="help-fname">Nsphere</span>('
            + '<span class="help-arg">p</span>: <span class="help-type">VEC3</span>, <span class="help-arg">r</span>: <span class="help-type">f32</span>)'
            + ' -&gt; <span class="help-type">VEC4</span></code></div><div class="help-def-text">A sphere of radius <code>r</code>.</div>'
            + '<div class="help-def-used">Used by <em>sphere</em>, <em>dome</em>.</div></li></ul>', d)
    ok('...code not of a signature\'s shape is the code it was, and no "Used by" none',
        html('- `x + y` -- the sum') === '<ul class="help-defs"><li class="help-def"><div class="help-sig"><code>x + y</code></div><div class="help-def-text">the sum</div></li></ul>',
        html('- `x + y` -- the sum'))
    ok('...a list with any other item a plain list, its definitions cards in it', html('- a\n- `f()` -- g') === '<ul><li>a</li><li class="help-def"><div class="help-sig"><code>'
        + '<span class="help-fname">f</span>()</code></div><div class="help-def-text">g</div></li></ul>', html('- a\n- `f()` -- g'))
    ok('...a signature escaped: no tag of its own', !html('- `f(a: vec3<f32>) -> <b>` -- x').includes('<b>') && html('- `f(a: vec3<f32>)` -- x').includes('vec3&lt;f32&gt;'))
}

// ---- nothing gets in
ok('HTML in a page is text', !html('<script>alert(1)</script> <img src=x onerror=1>').includes('<script') && !html('<img src=x>').includes('<img'))
ok('a javascript: link is text, not a link', !html('[x](javascript:alert(1))').includes('<a'))
ok('a data: image is not drawn', !html('![x](data:image/png;base64,AA)').includes('<img'))
ok('a quote in a link cannot end the attribute', !html('[x](a.md"onclick=1)').includes('onclick="'), html('[x](a.md"onclick=1)'))
ok('safeHref: the kinds the panel follows, and no other', ['help:x', 'example:a.json', 'cmd:a.b', 'show:properties', '#part', 'https://x.org', 'a/b.md', 'b.md#c']
    .every(safeHref) && !['javascript:x', 'data:x', 'file:///x', 'a.html'].some(safeHref))
ok('escapeHtml', escapeHtml('<a href="x">&\'') === '&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
ok('slug: as GitHub makes them, near enough', slug('How shapes are made: distance functions') === 'how-shapes-are-made-distance-functions')

// ---- a widget
{
    const r = renderMarkdown('# T\n```widget sdf\nmode: blend\nstep: 0.5\n```')
    ok('a widget block: a placeholder and its settings, a number a number', r.html.includes('data-widget="0"') && r.widgets[0].name === 'sdf'
        && r.widgets[0].settings.mode === 'blend' && r.widgets[0].settings.step === 0.5, JSON.stringify(r.widgets))
    ok('...its name read from the next line too', renderMarkdown('```widget\nsdf\nmode: box\n```').widgets[0].name === 'sdf')
}

// ---- links
ok('kindOf: each kind', JSON.stringify(['help:sdf', '#x', 'example:a.json', 'cmd:analysis.setup', 'show:properties', 'show:menu:Analysis', 'https://x.org', 'javascript:x']
    .map(h => kindOf(h).kind)) === JSON.stringify(['page', 'anchor', 'example', 'cmd', 'show', 'show', 'web', null]))
ok('kindOf: a page by file, from another page\'s folder, with an anchor', JSON.stringify(kindOf('../reference/shapes.md#box', 'modelling/sdf.md'))
    === JSON.stringify({ kind: 'page', target: 'reference/shapes.md', anchor: 'box' }))
ok('resolve', resolve('optics/units.md', '../start/welcome.md') === 'start/welcome.md' && resolve('a/b.md', 'c.md') === 'a/c.md' && resolve('', 'x.md') === 'x.md')
{
    const l = linksIn('[a](a.md) `[b](b.md)`\n```\n[c](c.md)\n```\n![p](p.png) [d](cmd:x)')
    ok('linksIn: links with their lines, none in code, an image marked', JSON.stringify(l.map(x => [x.href, x.line, x.image]))
        === JSON.stringify([['a.md', 1, false], ['p.png', 5, true], ['cmd:x', 5, false]]), JSON.stringify(l))
}

console.log(`markdown: ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
