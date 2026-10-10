// node tools/test/timeline.check.mjs
//
// THE TIMELINE TOOL IN A BROWSER: tools/test/timeline.html -- the shell, a viewport and the Timeline panel as
// index.html makes them, over a stand-in renderer -- driven headless. The application's own page stops at
// WebGPU, so without this the panel, its registry and the record path were code nothing ever ran (CLAUDE.md:
// a feature nothing exercises has never run). It checks:
//   the panel: the editor mounted in the dock, its grip hidden, the export's frame over the picture
//     (narrower than the view: the box it keeps; wider: the view, and a note that it sees past the sides)
//   + track: the live parameter offered, the structural one not
//   a track: keyed, and the playhead moving the value through PARAMS
//   RECORD (PNG, three frames): begin once at the export size, every frame invalidated before it is
//     traced, the values the frame's time says, a grab each, end once, a file downloaded, the view
//     covered while it ran and uncovered after
//   RECORD (GIF): offered in the menu, a .gif downloaded, Chromium's decoder reading each frame's colour
//   another scene: + track lists the new scene's parameters, a track on the old one reads (unknown)
//   closed: a closed panel stops playing
// Whether the real renderer films what it should is the user's to see.
//
// OPTIONAL, AND LOUD ABOUT IT, as lib/shell/test/example.check.mjs is: it needs Playwright's Chromium.
/* global CHECK -- the page's own, read inside page.evaluate() */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execSync } from 'node:child_process'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let chromium
try { ({ chromium } = await import('playwright')) } catch {
    try { ({ chromium } = await import(pathToFileURL(join(execSync('npm root -g').toString().trim(), 'playwright/index.mjs')).href)) } catch { }
}
if (!chromium) { console.log('(timeline tool check SKIPPED: no playwright. npm i -g playwright to get it.)'); process.exit(0) }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer(async (req, res) => {
    try {
        const path = join(repo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
        if (!path.startsWith(repo)) throw new Error('outside')
        res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
        res.end(await readFile(path))
    } catch { res.writeHead(404); res.end() }
})
await new Promise(r => server.listen(0, r))
const port = server.address().port

const b = await chromium.launch({ args: ['--disable-gpu'] })
const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true })).newPage()
const errs = []
p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)) })
let failed = 0
const ok = (n, c, x = '') => { if (!c) failed++; console.log((c ? 'ok    ' : 'FAIL  ') + n + (c ? '' : '  ' + x)) }
try {
    await p.goto(`http://localhost:${port}/tools/test/timeline.html`); await p.waitForTimeout(800)

    // ---- the panel -------------------------------------------------------------------------------
    const panel = await p.evaluate(() => {
        const el = document.querySelector('[data-panel="tools.timeline"]'), tl = el?.querySelector('.tl'), lanes = el?.querySelector('.tl-lanes canvas')
        const g = CHECK.stage.querySelector('.rt-aspect')
        return { tl: !!tl, h: tl?.clientHeight ?? 0, lanes: lanes?.clientWidth ?? 0, grip: tl && getComputedStyle(tl.querySelector('.tl-grip')).display,
            guide: g && [g.clientWidth, g.clientHeight, g.textContent], stage: [CHECK.stage.clientWidth, CHECK.stage.clientHeight],
            picker: [...el.querySelectorAll('.tl-add option')].map(o => o.value).filter(Boolean) }
    })
    ok('the editor is in the dock, filling its panel', panel.tl && panel.h > 150 && panel.lanes > 300, JSON.stringify(panel))
    ok('its grip is hidden: the dock sizes the panel', panel.grip === 'none', panel.grip)
    // the stand-in's picture is 4:3, so a 16:9 film is wider than it: the box is the picture, and it says so
    ok('a film wider than the view: the frame is the picture, and says it goes past the sides', !!panel.guide
        && Math.abs(panel.guide[0] / panel.guide[1] - 4 / 3) < 0.02 && /1920×1080 — wider/.test(panel.guide[2]), JSON.stringify(panel.guide))
    await p.selectOption('[data-panel="tools.timeline"] .tl-export .tl-sel', 'square  1080×1080')
    const square = await p.evaluate(() => { const g = CHECK.stage.querySelector('.rt-aspect'); return g && [g.clientWidth, g.clientHeight, g.textContent] })
    ok('a narrower one (square, from the export menu): the box it keeps, as tall as the picture', !!square
        && Math.abs(square[0] / square[1] - 1) < 0.02 && Math.abs(square[1] - panel.guide[1]) < 2 && !/wider/.test(square[2]), JSON.stringify(square))
    ok('+ track offers the live parameter and not the structural one', JSON.stringify(panel.picker) === '["scene/lamp/light/flux"]', JSON.stringify(panel.picker))

    // ---- a track: 0 at the start, 800 at the end ------------------------------------------------
    await p.selectOption('[data-panel="tools.timeline"] .tl-add', 'scene/lamp/light/flux')
    const moved = await p.evaluate(async () => {
        const T = CHECK.TL.timeline, k = T.track('scene/lamp/light/flux')
        T.fps = 10; T.duration = 0.3
        T.setKey(k, 0, 0); T.setKey(k, 0.3, 800); k.interp = 'linear'
        CHECK.TL.seek(0.15)
        return { keys: k.keys.length, flux: CHECK.S.flux, heads: [...document.querySelectorAll('.tl-head-name')].map(e => e.textContent) }
    })
    ok('a track added from the picker, named by its label', moved.heads.join() === 'lamp › flux', JSON.stringify(moved.heads))
    ok('the playhead moves the value through the parameters', moved.flux === 400, JSON.stringify(moved))

    // ---- RECORD ----------------------------------------------------------------------------------
    const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    const run = await p.evaluate(async () => {
        Object.assign(CHECK.TL.settings, { format: 'png', width: 64, height: 36, samples: 5, from: 0, to: 0 })
        CHECK.log.length = 0
        let covered = false
        const watch = setInterval(() => { covered ||= !!CHECK.stage.querySelector('.shell-busy') }, 1)
        await CHECK.TL.record()
        clearInterval(watch)
        return { log: CHECK.log.slice(), covered, after: !!CHECK.stage.querySelector('.shell-busy'),
            status: document.querySelector('.tl-status')?.textContent, grab: CHECK.TL._lastGrab && [CHECK.TL._lastGrab.width, CHECK.TL._lastGrab.height] }
    })
    const want = ['begin 64x36', 'invalidate', 'render 5 in flight flux=0', 'grab', 'invalidate', 'render 5 in flight flux=266.6666666666667', 'grab',
        'invalidate', 'render 5 in flight flux=533.3333333333334', 'grab', 'end']
    ok('RECORD: begin at the export size, each frame invalidated, its own values, its samples one in flight, grabbed, then end', JSON.stringify(run.log) === JSON.stringify(want),
        `\n      got  ${JSON.stringify(run.log)}\n      want ${JSON.stringify(want)}`)
    ok('the frames are the export\'s size', JSON.stringify(run.grab) === '[64,36]', JSON.stringify(run.grab))
    ok('the view was covered while it recorded, and is not after', run.covered && !run.after, JSON.stringify(run))
    ok('the menu says it is done', /done/.test(run.status ?? ''), run.status)
    const file = await dl
    ok('a file was downloaded', file?.suggestedFilename() === 'raytracer.zip', file?.suggestedFilename())

    // ---- RECORD as a GIF: the same frames, read back by Chromium's own decoder ---------------------------
    // the stand-in fills each frame with one red, flux / 4: one colour a frame, so the palette holds it exactly
    const formats = await p.$$eval('[data-panel="tools.timeline"] .tl-export .tl-sel option', os => os.map(o => o.value))
    ok('the export menu offers GIF', formats.includes('gif'), JSON.stringify(formats))
    const gdl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null)
    await p.evaluate(async () => { CHECK.TL.settings.format = 'gif'; await CHECK.TL.record() })
    const gfile = await gdl
    ok('a GIF was downloaded', gfile?.suggestedFilename() === 'raytracer.gif', gfile?.suggestedFilename())
    if (gfile) {
        const bytes = [...await readFile(await gfile.path())]
        const gif = await p.evaluate(async bytes => {
            const dec = new ImageDecoder({ data: new Uint8Array(bytes), type: 'image/gif' })
            await dec.tracks.ready
            const t = dec.tracks.selectedTrack, frames = []
            for (let i = 0; i < t.frameCount; i++) {
                const { image } = await dec.decode({ frameIndex: i })
                const c = new OffscreenCanvas(image.displayWidth, image.displayHeight), g = c.getContext('2d')
                g.drawImage(image, 0, 0)
                frames.push({ size: [c.width, c.height], cs: image.duration / 1e4, rgb: [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3)] })
                image.close()
            }
            return { loops: String(t.repetitionCount), frames }
        }, bytes)
        const wantGif = { loops: 'Infinity', frames: [0, 67, 133].map(r => ({ size: [64, 36], cs: 10, rgb: [r, 0, 0] })) }
        ok('the GIF: three frames at the export size, 10 cs each at 10 fps, each its frame\'s colour, looping', JSON.stringify(gif) === JSON.stringify(wantGif),
            `\n      got  ${JSON.stringify(gif)}\n      want ${JSON.stringify(wantGif)}`)
    }

    // ---- another scene: the + track list follows it -------------------------------------------------
    // the list was filled once and kept the first scene's parameters (the user, 2026-09-29)
    await p.evaluate(() => CHECK.PARAMS.provide('scene', () => [
        { path: 'scene/sun/light/cct', label: 'sun › CCT', group: 'scene · sun', min: 1000, max: 15000, get: () => 5000, set: () => { } }]))
    await p.dispatchEvent('[data-panel="tools.timeline"] .tl-add', 'pointerdown')
    const other = await p.evaluate(() => ({
        picker: [...document.querySelectorAll('[data-panel="tools.timeline"] .tl-add option')].map(o => o.value).filter(Boolean),
        heads: [...document.querySelectorAll('.tl-head-name')].map(e => e.textContent) }))
    ok('another scene: + track lists its parameters as the list is opened', JSON.stringify(other.picker) === '["scene/sun/light/cct"]', JSON.stringify(other.picker))
    ok('...and a track on the old scene\'s node says it names nothing here', /\(unknown\)/.test(other.heads.join()), JSON.stringify(other.heads))
    await p.evaluate(() => CHECK.PARAMS.provide('scene', () => [
        { path: 'scene/lamp/light/flux', label: 'lamp › flux', group: 'scene · lamp', min: 0, max: 1000, get: () => CHECK.S.flux, set: v => { CHECK.S.flux = v } }]))
    await p.evaluate(() => CHECK.TL.refreshParams())
    const back = await p.evaluate(() => [...document.querySelectorAll('.tl-head-name')].map(e => e.textContent))
    ok('refreshParams (the host calls it on every scene shown): the track has its name back', back.join() === 'lamp › flux', JSON.stringify(back))

    // ---- closed: stops playing ------------------------------------------------------------------
    const closed = await p.evaluate(async () => {
        CHECK.TL.timeline.duration = 30
        CHECK.TL.ui.play()
        const was = CHECK.TL.ui.playing
        CHECK.SHELL.dock.getPanel('tools.timeline').api.close()
        await new Promise(r => setTimeout(r, 200))
        return { was, now: CHECK.TL.ui.playing, guide: !!CHECK.stage.querySelector('.rt-aspect') }
    })
    ok('closing the panel stops the playback and takes the frame away', closed.was && !closed.now && !closed.guide, JSON.stringify(closed))

    ok('no page errors', errs.length === 0, errs.join(' | '))
} finally {
    await b.close(); server.close()
}
console.log(failed ? `timeline tool: ${failed} FAILED` : 'timeline tool: all passed')
process.exit(failed ? 1 : 0)
