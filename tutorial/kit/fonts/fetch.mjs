// node tutorial/kit/fonts/fetch.mjs
//
// THE STYLES' TYPEFACES, KEPT HERE, so the tutorial loads nothing from another site (they came from Google Fonts while
// the styles were mockups; THIRD_PARTY.md). For every style in ../styles.js this asks Google Fonts for its `fonts`
// query once, keeps the latin faces (and greek, where a family has it: the pages write θ, ρ and π), downloads each
// woff2 file and each family's licence (the SIL Open Font License, from the google/fonts repository), and writes
// fonts.css with an @font-face rule per face pointing at the files beside it. kit.css imports fonts.css; a browser
// fetches only the faces a page's style uses.
//
// Run it again only to change what is kept (a family, a weight) or to take newer files: what it writes is committed,
// and the test (tutorial/test/tutorial.test.mjs) holds fonts.css, the files and the licences to the styles' list.
// It fetches with curl, which follows the environment's proxy and CA settings (CURL_CA_BUNDLE).
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { STYLES } from '../styles.js'

const DIR = dirname(fileURLToPath(import.meta.url))
// Google serves woff2 by the browser it is asked by: ask as a current Chrome
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const KEEP = new Set(['latin', 'greek'])
const get = (url, out) => execFileSync('curl', ['-sSfL', '-A', UA, url, ...(out ? ['-o', out] : [])], { encoding: out ? undefined : 'utf8', maxBuffer: 1 << 24 })
const slug = family => family.toLowerCase().replace(/[^a-z0-9]/g, '')

mkdirSync(DIR, { recursive: true })
const faces = [], files = new Map(), families = new Set()
for (const st of STYLES) {
    const css = get(`https://fonts.googleapis.com/css2?${st.fonts}&display=swap`)
    // Google's answer is a run of `/* subset */ @font-face { ... }` blocks
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
        const [, subset, body] = m
        if (!KEEP.has(subset)) continue
        const prop = k => new RegExp(`${k}:\\s*([^;]+);`).exec(body)?.[1].trim()
        const family = prop('font-family').replace(/['"]/g, ''), style = prop('font-style'), weight = prop('font-weight')
        const url = /url\(([^)]+)\)/.exec(prop('src'))[1]
        // one file can serve several weights (a variable font): kept once, named by what it first served
        if (!files.has(url)) files.set(url, `${slug(family)}-${weight.replace(/\s+/g, '-')}${style === 'italic' ? '-italic' : ''}-${subset}.woff2`)
        families.add(family)
        faces.push({ family, style, weight, subset, file: files.get(url), range: prop('unicode-range') })
    }
}
for (const [url, file] of files) get(url, join(DIR, file))
for (const f of families) get(`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug(f)}/OFL.txt`, join(DIR, `${slug(f)}-OFL.txt`))
writeFileSync(join(DIR, 'fonts.css'), `/* THE STYLES' TYPEFACES, kept in the repository: written by fetch.mjs from Google Fonts (do not edit by hand; run it).
   ${families.size} families, ${faces.length} faces, ${files.size} files, each family under the SIL Open Font License (its *-OFL.txt beside it). */
${faces.map(f => `@font-face { font-family: '${f.family}'; font-style: ${f.style}; font-weight: ${f.weight}; font-display: swap;
    src: url("${f.file}") format("woff2"); unicode-range: ${f.range}; }  /* ${f.subset} */`).join('\n')}
`)
console.log(`${families.size} families, ${faces.length} faces, ${files.size} files, ${families.size} licences -> ${DIR}`)
