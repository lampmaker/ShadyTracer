//======================================================================================================================
// THE TIMELINE, as a tool of this application: lib/timeline's keyframe editor and video export, docked
// as a panel, animating the parameter registry (lib/shell/params.js) and filmed by the renderer's
// offscreen verbs.
//
// NOTHING HERE IS A NEW MECHANISM. Each of the three parts already existed and was built for this:
//   what can move     PARAMS -- "the timeline's registry contract, with a path for an id" (params.js).
//                     A track is a path: 'scene/<node id>/light/flux', 'view/camera/azimuth'.
//   how a frame is    RT.beginOffscreen / renderFrame / grabFrame / endOffscreen -- "THE VERBS ARE
//   made              NAMED FOR lib/timeline ON PURPOSE" (lib/pathtracer/index.js, OFFSCREEN RENDERING)
//   the editor, the   makeSequencer (lib/timeline/sequencer.js), unchanged: it is a vendored copy of
//   export, the file  CODE_WOOD's and is changed there, never here (its README)
// What this file adds is the glue those contracts left to a host, and the three things that go wrong
// when they meet (below).
//
// ONLY LIVE PARAMETERS ARE OFFERED. An entry whose kind is 'structural' changes the shader: a compile,
// seconds, on every frame the value moves -- and during a recording a compile would swap the kernels
// under an offscreen target (setScene knows nothing of one). A timeline that offers it is a timeline
// that stalls or breaks on the first key. So the registry the sequencer sees is PARAMS with those left
// out: the + track list does not show them, and a track on one (a file from elsewhere, or an entry
// that has since become structural -- a plain union's blend is one) reads "(unknown)" and is skipped.
//
// ONE FRAME IS ITS OWN PICTURE. renderFrame accumulates into the target; after the playhead moves the
// values, a changed uniform flags a reset -- but a frame whose values did not change (a held key) flags
// none, and would go on averaging into the frame before it. The film would then clean up across a hold
// and snap back to noise when motion resumes. Every frame is therefore invalidated before it is traced,
// so every frame has exactly the samples the export asked for.
//
// THE VIEW IS COVERED WHILE IT RECORDS. The live camera and the recording's are one camera: an orbit in
// the viewport mid-recording would move the film. A busy card over the picture takes the pointer, and
// says how far it has got.
//======================================================================================================================

import { makeSequencer } from '../lib/timeline/sequencer.js'

/** PARAMS as the timeline's registry, with the structural entries left out (see the header). Pure:
 *  the node test drives it with a toy provider. Everything is asked of PARAMS afresh each call, since
 *  its providers are (nodes come and go with every edit). */
export function liveRegistry(P) {
    /* A VALUE NOT FLAGGED ANIMATED, while others are (builder model.js setAnimated), says so in its track's header: the
       bake keeps only the flagged ones uniforms, so playing this one sends the picture back to the editing build */
    const live = p => !p || p.kind === 'structural' ? undefined
        : !p.animated && P.anyAnimated?.() ? { ...p, label: `${p.label ?? p.path} (not animated)` } : p
    const known = id => { const p = P.get(id); return !!p && p.kind !== 'structural' }
    const R = {
        /* the + track list: the animated alone while any are and the person has not asked for all (lib/shell/params.js
           shown, the Parameters panel's box and the one beside + track) */
        list: () => (P.shown ? P.shown() : P.list()).filter(p => p.kind !== 'structural'),
        get: id => live(P.get(id)),
        has: id => !!R.get(id),
        range: p => P.range(p),
        current: id => R.get(id) ? P.current(id) : undefined,
        coerce: (p, v) => P.coerce(p, v),
        /** The timeline's values, quietly (no undo step each: playing is not an edit); a structural
         *  or unknown path is skipped, as the timeline's own registry skips an unknown id. */
        apply(values) {
            const ok = {}
            // only whether it is there: the label get() gives is the headers', and asking every provider twice a value a frame is waste
            for (const id in values) if (known(id)) ok[id] = values[id]
            return P.apply(ok, 'timeline')
        },
    }
    return R
}

/**
 * @param el        the panel's element (filled once; the dock moves it)
 * @param PARAMS    the parameter registry
 * @param RT        the renderer (its offscreen verbs, its live size)
 * @param stage     the viewport's element: the aspect guide and the busy card go over it
 * @param busy      busyOverlay(stage) from lib/shell: a card over the picture, or null to take it away
 * @param progress  a job's bar in the status bar: progress({ label, done, total }) or progress(null)
 * @param onVisible (fn) => told whether the panel is on screen
 */
export function installTimeline(el, { PARAMS, RT, stage, busy = () => { }, progress = () => { }, onVisible = () => { } }) {
    el.classList.add('rt-timeline')
    const registry = liveRegistry(PARAMS)
    let recording = false, frame = 0, frames = 0

    /* THE EXPORT'S FRAME, over the picture. The camera's field of view is VERTICAL (lib/camera.js: x is
       scaled by the aspect, y is not), so a film of another shape keeps the picture's height and changes
       its width: narrower, and it is the box drawn here; wider, and it sees past the view's sides, which
       no box inside the view can show -- so the guide says so instead of drawing a frame that lies. */
    const guide = document.createElement('div')
    guide.className = 'rt-aspect'
    const guideLabel = document.createElement('span')
    guide.appendChild(guideLabel)
    let shown = false
    /* the export's settings, as the sequencer last told them: it tells them once while it is being made,
       before it has returned anything to read them from */
    let S = null
    const drawGuide = () => {
        if (!shown || recording || !S?.width || !S?.height) { guide.remove(); return }
        const { w, h } = RT.size()
        const sw = stage.clientWidth, sh = stage.clientHeight
        if (!(w > 0 && h > 0 && sw > 0 && sh > 0)) { guide.remove(); return }
        // the picture in the stage: object-fit contain (lib/pathtracer/index.js, RENDER SIZE)
        const k = Math.min(sw / w, sh / h), pw = w * k, ph = h * k
        const ea = S.width / S.height, la = w / h
        const bw = ea <= la ? ph * ea : pw
        Object.assign(guide.style, { width: `${bw}px`, height: `${ph}px`, left: `${(sw - bw) / 2}px`, top: `${(sh - ph) / 2}px` })
        guide.classList.toggle('wider', ea > la * 1.001)
        guideLabel.textContent = `video ${S.width}×${S.height}` + (ea > la * 1.001 ? ' — wider than the view: it also shows past both sides' : '')
        if (guide.parentNode !== stage) stage.appendChild(guide)
    }
    new ResizeObserver(drawGuide).observe(stage)

    const seq = makeSequencer({
        host: el, registry,
        storageKey: 'raytracer.timeline',
        defaults: { timeline: { fps: 30, duration: 8 }, export: { width: 1920, height: 1080, samples: 64, filename: 'raytracer' } },
        onSettings: s => { S = s; drawGuide() },
        /* THE LIVE SIZE, when the export menu's "canvas size" asks for the picture outside a recording:
           the sequencer calls grab() for its width and height then, synchronously. The renderer's
           grabFrame throws outside an offscreen render -- as a rejected promise nobody awaits. */
        grab: () => recording ? RT.grabFrame() : { width: RT.size().w, height: RT.size().h },
        begin: async ({ width, height, frames: n }) => {
            await RT.beginOffscreen({ width, height })
            recording = true; frame = 0; frames = n
            drawGuide()
        },
        render: async samples => {
            const job = { label: `Recording the video: frame ${frame + 1} of ${frames}`, done: frame, total: frames }
            busy(job); progress({ ...job, label: 'recording the video' })
            RT.invalidate()                          // this frame's own samples only (the header)
            /* ONE SAMPLE IN FLIGHT within a frame (lib/pathtracer/samples.js): its next sample recorded
               while the GPU runs this one. Never across frames: renderFrame returns only once the
               frame's last sample is done, and only then does the sequencer grab it and move the values. */
            await RT.renderFrame(samples, null, null, { inFlight: 2 })
            frame++
        },
        end: async () => {
            recording = false
            busy(null); progress(null)
            await RT.endOffscreen()
            drawGuide()
        },
    })
    /* THE GRIP IS FOR A PANEL AT THE BOTTOM OF A PAGE: it sets the host's height. In a dock the panel's
       size is the dock's, and a height set on the element would only fight it (hidden in timeline.css). */

    /* ESCAPE IN THE TIMELINE IS THE TIMELINE'S: it clears its selection and closes its popup. Left to
       bubble, the Builder's overlay took it as "up a level" and changed the scene's selection too. */
    seq.ui.root.addEventListener('keydown', e => { if (e.key === 'Escape') e.preventDefault() })

    /* THE + TRACK LIST IS FILLED WHEN IT IS OPENED, not only when it was built. lib/timeline fills it on a
       track added or removed -- right for a host whose properties are fixed, and this host's are not: they
       are the current scene's nodes, which change with every scene chosen, node added or file opened. The
       list kept the first scene's parameters (the user, 2026-09-29). ui.refresh() is the library's own
       rebuild of the headers and the list; it runs as the pointer goes down, before the list opens.
       Also on every scene shown (the host calls refreshParams), so a track on a node the scene no longer
       has reads "(unknown)" at once rather than at the next edit. Not while recording: it would not
       change what is filmed, and the headers are the recording's. */
    /* ANIMATED ONLY, beside + track: the Parameters panel's choice (lib/shell/params.js onlyAnimated), shown only while
       something is flagged */
    const only = document.createElement('label')
    only.className = 'rt-tl-only'
    only.title = 'Offer only the values flagged as animated (◆ in the properties panel): the bake keeps those live'
    const onlyBox = document.createElement('input')
    onlyBox.type = 'checkbox'
    only.append(onlyBox, ' animated only')
    onlyBox.onchange = () => { PARAMS.setOnlyAnimated?.(onlyBox.checked); refreshParams() }
    const syncOnly = () => {
        const any = !!PARAMS.anyAnimated?.()
        only.style.display = any ? '' : 'none'
        onlyBox.checked = any && !!PARAMS.onlyAnimated?.()
    }
    const refreshParams = () => { if (!recording) { syncOnly(); seq.ui.refresh() } }
    const picker = seq.ui.bar.querySelector('.tl-add')
    picker?.after(only)
    syncOnly()
    for (const ev of ['pointerdown', 'focus']) picker?.addEventListener(ev, refreshParams, true)
    seq.refreshParams = refreshParams

    /* A CLOSED PANEL DOES NOT PLAY ON: its values would go on changing the scene with nothing on
       screen to say why. Shown again, it is laid out afresh -- a panel moved while hidden measured 0. */
    onVisible(v => {
        shown = v
        if (v) seq.ui.layout(); else if (!recording) seq.ui.pause()
        drawGuide()
    })
    return seq
}
