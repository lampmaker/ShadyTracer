//======================================================================================================================
// A REPORT TO PASTE BACK, for a fault the page cannot see for itself (Help › Report).
//
// It began with the LED's spot missing from the optics test in one Chrome profile and present in an
// incognito window of the same Chrome, no error anywhere, and back of its own a while later. Two causes
// fit that and look the same on screen, so the report says which it was:
//   THE PHOTONS    the optics sources' photons ride in the renderer's ray buffer after the camera rays;
//                  a large viewport filled it and they got none (fixed: raytrace_main.js shares the room
//                  now; RT.lightReport() says what each source asked for and got, and why none)
//   STALE FILES    a module or scene the browser took from its HTTP cache without asking the server,
//                  from before an update: a server that sends no Cache-Control lets Chrome reuse a file
//                  for a tenth of its age, and a hard refresh does not reach every module a page
//                  imports. Incognito starts with an empty cache, and the copy expires "after a
//                  while". staleFiles() fetches each such file again from the server and compares.
//
//   const text = await report({ RT, OPTICS })     // the lines, also logged
//   const stale = await staleFiles()              // [url] whose cached copy differs from the server's
//   await reloadFresh(stale)                      // refetch those past the cache, then reload the page
//======================================================================================================================
import { versionText } from './version.js'

/* The page's own files: modules, scenes, styles -- what an update changes */
const ours = e => e.name.startsWith(location.origin) && /\.(m?js|json|css|html)(\?|#|$)/.test(e.name)

/** The files this page loaded straight from the browser's cache, without asking the server whether
 *  they changed: transferSize 0 with a body (a revalidated 304 transfers its headers, so it is > 0). */
export const cachedFiles = () => performance.getEntriesByType('resource')
    .filter(e => ours(e) && e.transferSize === 0 && e.decodedBodySize > 0).map(e => e.name)

/** Of the files taken from the cache unasked, those whose cached copy is not what the server has now:
 *  the page ran old code (or an old scene) with the new. Fetches each twice -- the cached copy and the
 *  server's -- so only when asked for. */
export async function staleFiles(urls = cachedFiles()) {
    const stale = []
    await Promise.all(urls.map(async url => {
        try {
            const [cached, fresh] = await Promise.all([
                fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }).then(r => r.ok ? r.text() : null).catch(() => null),
                fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.text() : null),
            ])
            if (cached != null && fresh != null && cached !== fresh) stale.push(url)
        } catch { }
    }))
    return stale.sort()
}

/** Refetch past the cache -- which replaces the cached copy -- then reload: the next load takes the
 *  server's files. Every file of ours when none are named. */
export async function reloadFresh(urls = performance.getEntriesByType('resource').filter(ours).map(e => e.name)) {
    await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => null)))
    location.reload()
}

/** The report: the picture's photons (RT.lightReport), the optics sources, and the files the page ran
 *  from its cache, compared with the server's. Resolves to its text, and logs it. */
export async function report({ RT, OPTICS } = {}) {
    const lines = [versionText(), `page ${location.href}`, `${navigator.userAgent}`, '']
    try { lines.push(RT?.lightReport?.() ?? 'no renderer') } catch (e) { lines.push(`renderer: ${e.message}`) }
    try {
        const s = OPTICS?.sources ?? []
        lines.push(`optics: ${s.length} source(s) traced; the picture ${OPTICS?.picture?.on ? 'is' : 'is NOT'} lit by them`
            + `${OPTICS?.picture?.on && !OPTICS.picture.applies() ? ', but the scene showing is not theirs' : ''}`)
    } catch (e) { lines.push(`optics: ${e.message}`) }
    const cached = cachedFiles()
    const stale = await staleFiles(cached)
    lines.push('', `${cached.length} of the page's files came from the browser's cache without asking the server`)
    lines.push(stale.length ? `STALE -- the cached copy is not what the server has now (Help › Reload every file fresh):\n${stale.map(u => '  ' + u.replace(location.origin, '')).join('\n')}`
        : 'none of them differs from the server\'s copy')
    const text = lines.join('\n')
    console.log(`[report]\n${text}`)
    return text
}
