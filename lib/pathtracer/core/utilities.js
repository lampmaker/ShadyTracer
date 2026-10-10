//======================================================================================================================
// The render HUD.
//
// TWO THINGS MAKE A LIVE READOUT UNREADABLE, and this had both. It repainted on every frame --
// at 30-60 fps, digits change faster than an eye can settle on them -- and it showed the
// INSTANTANEOUS frame rate, which on a path tracer swings by a factor of two frame to frame.
// So: repaint four times a second, from smoothed values only, in fixed-width columns so nothing
// reflows as the numbers change. A number you cannot read is not a measurement.
//
// window.RTSTATS() prints one settled line to the console, for when you want to copy a reading
// somewhere rather than squint at a corner of the screen.
//
// A TABLE, NOT LINES OF TEXT (0.22.1). The readout was text joined by newlines in a div that does not keep them, so in
// the Render stats panel it ran together into one long line. Now each reading is a row -- what, the number, its unit --
// under a heading for what it is about, and what is wrong or partial (Draft, flushed rays, photons short) above them.
//======================================================================================================================

const HUDMS = 250;             // ms between repaints -- four a second is readable and still live

let _fps_last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
let _fps_avg = 0;
let _frame_num = 0;
let _hud_last = 0;
let _last = { fps: 0, count: 0, frame: 0 };
let _paced = 0;                // fraction of rAF turns pacing withheld, over the last repaint

const fix = (v, d = 1) => typeof v === 'number' ? v.toFixed(d) : String(v);

/** `showFPS.mount` -- an element to render the readout into, as a normal block. Left unset it
 *  is pinned to the top-right corner of the window instead.
 *  @param count samples this frame @param reset restart the frame counter
 *  @param cost optional lib/render-cost.js instrument; without it only the loop rate is known,
 *  and the loop rate is not the render rate -- see the instrument's header. */
let _cost = null;              // the last instrument handed in, for refresh()

export let showFPS = (count, reset, cost) => {
    const _now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const _dt = Math.max(0.0001, _now - _fps_last);
    _fps_avg = (_fps_avg === 0) ? (1000 / _dt) : (_fps_avg * 0.9 + (1000 / _dt) * 0.1);
    _fps_last = _now;
    _frame_num++;
    if (reset) _frame_num = 0;
    _last = { fps: _fps_avg, count, frame: _frame_num, dt: _dt, iterations: showFPS.iterations, batches: showFPS.batches, slice: showFPS.slice };

    _cost = cost;
    if (_now - _hud_last < HUDMS) return;           // accumulate; repaint on the slow clock
    _hud_last = _now;
    if (cost) _paced = cost.takePaced();
    paint(cost);
}

/** Repaint from what is already known, without counting a frame -- for a readout that changed
 *  while the loop is paused (the cursor moved over a finished picture). */
showFPS.refresh = () => paint(_cost);

/* THE READOUT'S ELEMENT, KEPT, NOT LOOKED UP. It was found with document.getElementById at every repaint, which fails
   whenever the panel is not in the page's document -- a tab of its group not shown (the dock takes it out of the page),
   or the panel popped out to a window of its own -- and every failure appended another readout to the panel: four a
   second, a growing stream (the user, 2026-10-05). Now there is one, made in the mount's own document and used for as
   long as it is still the mount's child; one left from before is taken away.
     WHERE IT LIVES. Two earlier attempts got this wrong and both are worth remembering. position:fixed at the top right
   put it over the CONTROL PANEL, because that is what is at the top right of a window. Anchoring it to the canvas's
   wrapper meant giving that wrapper position:relative -- and the canvas is created position:absolute at height:100%
   (lib/utils.js), so the wrapper became its containing block, had no in-flow children left, collapsed to zero height,
   and took the canvas to 615x0 with it. So it is not an overlay: showFPS.mount is a plain element in the side panel and
   this is an ordinary block inside it. Without a mount it falls back to the fixed corner, which is what a page with no
   side panel wants. */
let _hud = null;
const HUD_ID = 'fpsHud';
function hudElement() {
    if (typeof document === 'undefined' || !document) return null;
    const host = showFPS.mount || document.body;
    if (!host) return null;
    if (_hud && _hud.parentNode === host) return _hud;
    for (const old of [...(host.children || [])]) if (old.id === HUD_ID) host.removeChild(old);
    const doc = host.ownerDocument || document;
    _hud = doc.createElement('div');
    _hud.id = HUD_ID;
    _hud.className = 'rt-stats';
    if (host === doc.body) Object.assign(_hud.style, { position: 'fixed', top: '4px', right: '8px', padding: '4px 2px',
                                                       background: 'rgba(0,0,0,0.65)', borderRadius: '4px', zIndex: '20' });
    host.appendChild(_hud);
    return _hud;
}

/* ITS LOOK, once per document it is in (a popped-out panel is another document), in the shell's palette where there is
   one (lib/shell/shell.css: --sh-*) and plain greys where there is not. The numbers in a column of their own, right-
   aligned in figures of one width, so nothing moves sideways as they change. */
const STYLE_ID = 'rt-stats-style';
const STYLE = `
.rt-stats { font: 12px/1.4 var(--sh-sans, system-ui, sans-serif); color: var(--sh-ink, #dde3e8); }
.rt-stats table { border-collapse: collapse; width: 100%; }
.rt-stats td { padding: 1px 6px; vertical-align: baseline; }
.rt-stats td.k { color: var(--sh-muted, #8fa3b3); white-space: nowrap; }
.rt-stats td.v { text-align: right; white-space: nowrap; min-width: 7ch; font-family: var(--sh-mono, ui-monospace, monospace);
                 font-variant-numeric: tabular-nums; color: var(--sh-ink, #dde3e8); }
.rt-stats td.u { color: var(--sh-muted, #8fa3b3); width: 100%; }
.rt-stats tr.head td { padding: 7px 6px 2px; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
                       color: var(--sh-faint, #6f7d89); border-bottom: 1px solid var(--sh-line, #2a3138); }
.rt-stats tr.head:first-child td { padding-top: 2px; }
.rt-stats tr.warn td { color: var(--sh-warn, #d9a226); padding: 2px 6px; }
.rt-stats td.u .n { color: var(--sh-faint, #6f7d89); margin-left: 0.7em; }
`;
function styleInto(doc) {
    if (!doc || doc.getElementById(STYLE_ID)) return;
    const s = doc.createElement('style');
    s.id = STYLE_ID;
    s.textContent = STYLE;
    (doc.head || doc.body).appendChild(s);
}

/* The rows as a table: a warning across all three columns, a heading the same, a reading as what | number | unit */
function paint(cost) {
    try {
        const el = hudElement();
        if (!el) return;
        const doc = el.ownerDocument;
        styleInto(doc);
        const table = doc.createElement('table');
        for (const r of statsRows(cost)) {
            const tr = doc.createElement('tr');
            const cell = (cls, text, span = 1) => {
                const td = doc.createElement('td');
                if (cls) td.className = cls;
                if (span > 1) td.colSpan = span;
                td.textContent = text;
                return tr.appendChild(td);
            };
            if (r.warn != null) { tr.className = 'warn'; cell('', r.warn, 3); }
            else if (r.head != null) { tr.className = 'head'; cell('', r.head, 3); }
            else {
                cell('k', r.k); cell('v', r.v);
                const u = cell('u', r.u ?? '');
                // what qualifies the reading, fainter, after its unit
                if (r.n) { const n = doc.createElement('span'); n.className = 'n'; n.textContent = r.n; u.appendChild(n); }
            }
            table.appendChild(tr);
        }
        el.replaceChildren(table);
    } catch { }
}

/* A luminance for the readout: four significant figures however bright -- a dim wall and the sun
   are the same instrument, and toFixed would print the sun as ten digits. */
const lum = v => v >= 1e5 || (v > 0 && v < 0.01) ? v.toExponential(3) : v.toPrecision(4);

/* WHAT THE PICTURE IS, when it is not the full one (quality.js effective, index.js buildUniforms
   puts it here): first, so a darker shade or a missing caustic is never mistaken for a fault. */
const RENDER_LINE = ['', 'DRAFT: direct light only (no bounce light)', 'SKETCH: a fixed light, no shadows',
                     "OPTICS: the lights' rays to the first diffuse surface, a flat light"];
/**
 * THE READOUT'S ROWS, from what the renderer last handed showFPS: { warn } across the table, { head } a section's
 * heading, { k, v, u, n } a reading -- what it is, the number as text, its unit, and what qualifies it if anything. The
 * warnings first, then SPEED, THE PICTURE, UNDER THE CURSOR; a section with nothing to say is left out. Exported for the
 * test (lib/pathtracer/test/stats.test.mjs), which has no page.
 */
export const statsRows = cost => {
    const W = [], speed = [], picture = [], cursor = [];
    const r = showFPS.render;
    if (r) {
        if (r.mode) W.push(RENDER_LINE[r.mode] ?? '');
        else if (r.asked) W.push(`${RENDER_LINE[r.asked].split(':')[0]} ignored: a measuring view traces in full`);
        if (r.lampsOnly) W.push('LAMPS ONLY: no sun, sky or studio light');
        // a light seen only by its photons (a point, a ray file) is dark without them: said, never left to be found
        if (r.lightRaysOff && r.mode !== 2) W.push("LIGHTS' RAYS OFF: the light objects' photons are not traced");
    }
    /* Rays the last wavefront pass had to terminate. This was the safety light on the adaptive budget, and the budget
       is the worst case now (raytrace_main.js), so it says the worst case itself, or budgetOverride, cut paths short: 0
       means nothing is being truncated. Anything persistently non-zero means the budget is too tight and paths are
       ending early -- which shows up as dark patches long before it shows up in the frame rate. Hidden when it is zero,
       which is the state it should be in. */
    if (cost && showFPS.flushed > 0) W.push(`FLUSHED: ${showFPS.flushed} rays ended early (the iteration budget is too tight)`);
    /* Contributions the frame and splat buffers refused as NaN, infinite or negative, last sample. Like FLUSHED it is
       hidden at zero, which is where it should be; anything else is a bug in the shading, not noise, and it used to be
       invisible -- see DEPOSIT in wavefront.js. */
    if (cost && showFPS.nonfinite > 0) W.push(`NON-FINITE: ${showFPS.nonfinite} contributions dropped`);
    /* PHOTONS SHORT OF WHAT WAS ASKED, or a source adding none, and why (R.photonPlan). Hidden while every source gets
       all it asked for, like FLUSHED -- which since 0.38.1 (a sample in batches) every ready source does: what is left
       to say is a source not ready, off for a reason, or failed. A light-traced source's light missing from the picture -- the LED's spot on the
       screen -- was otherwise invisible as a fault: a buffer full of camera rays, a kernel still compiling or failed,
       the wrong scene showing. */
    const plan = showFPS.photonPlan;
    if (plan) {
        if (plan.lt.ask > 0 && plan.lt.got < plan.lt.ask)
            W.push(`${(100 * plan.lt.got / plan.lt.ask).toFixed(0)}% of the light-tracing photons (ray buffer full)`);
        for (const s of plan.sources) {
            if (s.ask > 0 && s.ready && s.got < s.ask) W.push(`${(100 * s.got / s.ask).toFixed(0)}% of ${s.name}'s photons (ray buffer full)`);
            else if (s.why && s.why !== 'off') W.push(`${s.name}: ${s.why}`);
        }
    }
    if (cost) {
        /* A SAMPLE IN BATCHES (core/photons.js planBatches): more rays and photons than the ray buffer holds, each batch
           the whole chain -- said, since it is why a large picture's sample takes that many times as long */
        const inBatches = (_last.batches | 0) > 1 ? ` \u00d7 ${_last.batches} batches` : '';
        /* A SAMPLE OVER SEVERAL FRAMES (raytrace_main.js, sliceMs): how far the sample in progress is, in batches -- a
           frame then holds part of a sample, not the governor's count */
        const n = _last.slice ? `a sample over frames: batch ${_last.slice} \u00d7 ${_last.iterations ?? '?'} iterations`
            : `${_last.count} a frame \u00d7 ${_last.iterations ?? '?'} iterations${inBatches}`;
        speed.push({ k: 'Samples', v: fix(cost.rate), u: '/ s', n });
        speed.push({ k: 'Per sample', v: fix(cost.ms, 2), u: 'ms', n: 'wall clock' });
        /* Against the SMOOTHED interval, not the instantaneous one. With inflight = 2 the loop records two frames back to
           back -- a few ms apart, recording time only -- and then waits for the queue, so the instantaneous interval
           alternates between ~4 ms and the real frame time. Dividing a smoothed numerator by that made one steady cpu
           figure read as 3% most of the time and 50% once a second, which looks like a measurement and is an artefact
           of the denominator. */
        const iv = _last.fps > 0 ? 1000 / _last.fps : 0;
        speed.push({ k: 'CPU', v: fix(cost.cpu, 2), u: 'ms', n: iv > 0 ? `${(cost.cpu / iv * 100).toFixed(0)}% of a frame` : '' });
        if (cost.lat > 1) speed.push({ k: 'Queue', v: fix(cost.lat), u: 'ms', n: `${(_paced * 100).toFixed(0)}% paced` });
    }
    /* `fps` is the LOOP rate, and says so: trace() records a submit and returns, so it says how fast JavaScript went
       round, not how fast samples finished. That is what the adaptive count steers by, which is why it is still shown. */
    speed.push({ k: 'Loop', v: fix(_last.fps), u: 'fps', n: `frame ${_last.frame}` });
    /* SAMPLES IN THE PICTURE, which "frame" is not: a frame carries several samples (the count above), and the EMA window
       caps how many of them the picture actually remembers. Both are needed to say whether a render has stopped
       converging or just been reset. */
    if (showFPS.samples !== undefined)
        picture.push({ k: 'Averaged', v: fix(showFPS.samples, 0), u: 'samples', n: `window ${showFPS.window > 0 ? showFPS.window : '\u221e'}` });
    // light tracing's photons per sample -- all it asked at any size since 0.38.1 (a sample in batches); 0 with it on: nothing to send from
    if (showFPS.photons > 0) picture.push({ k: 'Photons', v: fix(showFPS.photons / 1e6, 2), u: 'M a sample' });
    // what the auto-exposure metered, in the unit a camera would show -- the physical fact about this scene's
    // brightness, whatever the tone curve then does with it
    if (cost && showFPS.autoEV != null) picture.push({ k: 'Exposure', v: fix(showFPS.autoEV), u: 'EV100', n: 'metered (auto)' });
    /* THE SURFACE TOLERANCE IN USE (core/tolerances.js toleranceInUse, the facade hands it in): what a ray within which of a
       surface has hit it, and how it was chosen -- automatic it was shown nowhere, and it decides what a small part looks like */
    const tol = showFPS.tolerance;
    if (tol) picture.push({ k: 'Surface tolerance', v: tol.v, u: tol.u, n: tol.n });
    /* UNDER THE CURSOR: the pixel's mean luminance and its standard error -- the error of the MEAN, from the spread of
       its own samples (core/measure.js), so it falls as the picture converges and says when a number is good enough to
       write down. "n" is what the average is worth in equally weighted samples: the sample count for a true mean, about
       2N+1 for an EMA window of N. One sample has no error bar yet. In the illuminance view the picture holds E/pi, so
       the reading is pi times it, in lux; the relative error is the same either way. */
    const p = showFPS.probe;
    if (p) {
        cursor.push({ k: showFPS.lux ? 'Illuminance' : 'Luminance', v: lum(showFPS.lux ? Math.PI * p.L : p.L), u: showFPS.lux ? 'lx' : 'cd/m\u00b2' });
        cursor.push({ k: 'Error', v: p.rel != null ? '\u00b1 ' + (p.rel * 100).toFixed(p.rel < 0.01 ? 2 : 1) : '\u00b1 ?', u: '%', n: 'of the mean' });
        cursor.push({ k: 'Worth', v: p.nEff != null ? p.nEff.toFixed(0) : '-', u: 'samples' });
    }
    const rows = W.map(warn => ({ warn }));
    for (const [head, list] of [['Speed', speed], ['Picture', picture], ['Under the cursor', cursor]])
        if (list.length) rows.push({ head }, ...list);
    return rows;
};

/** A settled one-line snapshot, printed and returned. Easier to copy than a live corner. */
export const installStatsHook = cost => {
    if (typeof window === 'undefined') return;
    /** @param quiet true returns the snapshot without printing -- for the test bench, which
     *  collects one of these per case and prints the whole table at the end. */
    window.RTSTATS = (quiet = false) => {
        const s = {
            samplesPerSec: +cost.rate.toFixed(2),
            msPerSample: +cost.ms.toFixed(3),
            cpuMsPerFrame: +cost.cpu.toFixed(3),
            cpuPercentOfFrame: _last.fps ? +(cost.cpu * _last.fps / 10).toFixed(1) : null,
            queueMs: +cost.lat.toFixed(1),
            pacedFraction: +_paced.toFixed(2),
            samplesPerFrame: _last.count,
            samplesAveraged: showFPS.samples ?? null,
            photonsPerSample: showFPS.photons ?? null,
            wavefrontIterations: _last.iterations ?? null,
            batchesPerSample: _last.batches ?? null,
            iterationsUsed: showFPS.used ?? null,
            raysFlushed: showFPS.flushed ?? null,
            nonFinite: showFPS.nonfinite ?? null,
            autoEV100: showFPS.autoEV ?? null,
            // the cursor's pixel: mean luminance, its standard error, and what the average is worth
            cursorLuminance: showFPS.probe?.L ?? null,
            // ...and in the illuminance view, the lux that luminance stands for (pi L)
            cursorIlluminance: showFPS.lux && showFPS.probe ? Math.PI * showFPS.probe.L : null,
            cursorStdError: showFPS.probe?.se ?? null,
            cursorSamples: showFPS.probe?.nEff ?? null,
            loopFps: +_last.fps.toFixed(1),
            // what was traced: a cost read in Draft is not a cost of the full picture
            renderMode: showFPS.render?.mode ?? null,
            lampsOnly: showFPS.render ? showFPS.render.lampsOnly : null,
        };
        if (!quiet) console.log('[raytracer] ' + Object.entries(s).map(([k, v]) => `${k}=${v}`).join('  '));
        return s;
    };
};

export let rndu32 = _ => Math.floor(Math.random() * 4294967296);
export let seed_vec4u32 = _ => [rndu32(), rndu32(), rndu32(), rndu32()];

