//======================================================================================================================
// Tests for where a tip goes. Run: node test/funding.test.mjs
//
// What has to hold, none of it needing a GPU or a browser:
//   .github/FUNDING.yml names one GitHub Sponsors account -- the repository page's Sponsor button.
//   the app (app.html's inline script, which nothing imports) names that account's Sponsors page once, and opens it
//     from a Help row (help.sponsor) and from a link at the menu bar's right end (the shell's barEnd); the site's front
//     page (index.html, 0.80.0) and the README link the same page.
// Four places carry one name. Changing one and not the others sends a tip to a page that is not there, and nothing
// at run time would say so: the menu row opens whatever URL it holds.
//======================================================================================================================
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(repo, f), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; return }
    fail++
    console.log(`FAIL  ${name}${extra ? '\n      ' + extra : ''}`)
}

// ---- FUNDING.yml: `github: <name>`, the one key GitHub reads for its Sponsors button --------------------------------
const funding = read('.github/FUNDING.yml')
const user = /^github:\s*([A-Za-z0-9-]+)\s*$/m.exec(funding)?.[1]
ok('FUNDING.yml names a GitHub Sponsors account', !!user, funding)
const url = `https://github.com/sponsors/${user}`

// ---- the page: the address once, a Help row and the bar's link opening it ----------------------------------------------
const page = read('app.html')
const named = [...page.matchAll(/github\.com\/sponsors\/([A-Za-z0-9-]+)/g)].map(m => m[1])
ok('app.html names one Sponsors page, the one FUNDING.yml names', named.length === 1 && named[0] === user, JSON.stringify(named))
ok('...as the constant the row and the link read', page.includes(`const SPONSOR = '${url}';`))
const row = /C\(\{\s*id:\s*'help\.sponsor'[^\n]*/.exec(page)?.[0] ?? ''
ok('app.html registers help.sponsor', !!row)
ok('...in the Help menu', /menu:\s*'Help'/.test(row), row)
ok('...opening it in a new tab', row.includes(`window.open(SPONSOR, '_blank', 'noopener')`), row)
const link = /createElement\('a'\)[\s\S]{0,400}?SHELL\.barEnd\.appendChild/.exec(page)?.[0] ?? ''
ok('a link at the menu bar\'s right end (SHELL.barEnd)', !!link)
ok('...to it, in a new tab', /href:\s*SPONSOR\b/.test(link) && /target:\s*'_blank'/.test(link) && /rel:\s*'noopener'/.test(link), link)
ok('...saying Sponsor', /Sponsor'/.test(link), link)
ok('the shell gives that place, after the title', /titleEl, endEl\)/.test(read('lib/shell/shell.js')) && /barEnd:\s*endEl/.test(read('lib/shell/shell.js')))

// ---- the front page (index.html): a Sponsor button, to the same page -------------------------------------------------------
const home = read('index.html')
const homeNamed = [...home.matchAll(/github\.com\/sponsors\/([A-Za-z0-9-]+)/g)].map(m => m[1])
ok('the front page links a Sponsors page', homeNamed.length >= 1)
ok('...only the one FUNDING.yml names', homeNamed.every(n => n === user), JSON.stringify(homeNamed))

// ---- the README --------------------------------------------------------------------------------------------------------
const readme = read('README.md')
ok('the README links the same Sponsors page', readme.includes(`(${url})`))
ok('no other Sponsors page in the README', [...readme.matchAll(/github\.com\/sponsors\/([A-Za-z0-9-]+)/g)].every(m => m[1] === user))

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `${pass} assertions pass.`)
process.exit(fail ? 1 : 0)
