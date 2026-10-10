//======================================================================================================================
// WHICH TAB HOLDS WHICH PROJECT -- so two tabs never save over each other's work. UI_PLAN.md section 10.
//
// Without this, two tabs on one project would each save it as it changed, and whichever wrote last would
// silently throw away the other's edits. The user's rule (2026-10-02): the tab that has a project keeps it;
// a second tab works on ITS OWN COPY.
//
// A WEB LOCK per project (navigator.locks), held for as long as the tab works on it. The browser lets go of
// it when the tab closes or reloads, so a reload finds its own project free again, and two tabs opened at
// the same moment cannot both get one. Locks need a secure context (https, or localhost); a page served on a
// plain http address of the network has none, and then the tabs ASK each other over a BroadcastChannel
// instead: "who has p1?", answered within `wait` ms by the tab that does. That one cannot settle two tabs
// asking at the same instant, which only a lock can.
//
//   const T = createTabs()
//   await T.claim(id)     true: this tab has it now (or had it already); false: another tab does
//   T.release(id)         let it go: another project is opened here
//   await T.others()      the ids other tabs hold, for the projects list to say so
//   T.how                 'locks', 'channel', or 'none' (neither: every claim succeeds, and says nothing)
//======================================================================================================================

const PREFIX = 'raytracer.project:'

export function createTabs({ locks = globalThis.navigator?.locks, Channel = globalThis.BroadcastChannel, wait = 200 } = {}) {
    const mine = new Map()          // id -> how to let it go
    const how = locks?.request ? 'locks' : Channel ? 'channel' : 'none'

    /* THE CHANNEL'S SIDE: answer for what this tab holds */
    let ch = null
    const listeners = new Set()
    if (how === 'channel') {
        ch = new Channel('raytracer.projects')
        ch.onmessage = e => {
            const m = e.data || {}
            if (m.ask && mine.has(m.ask)) ch.postMessage({ have: m.ask })
            if (m.who) ch.postMessage({ holding: [...mine.keys()], to: m.who })
            for (const f of listeners) f(m)
        }
    }
    const listen = (ms, f) => new Promise(res => {
        listeners.add(f)
        setTimeout(() => { listeners.delete(f); res() }, ms)
    })

    return {
        how,
        async claim(id) {
            if (mine.has(id)) return true
            if (how === 'locks') {
                /* granted or not, known at once (ifAvailable); held until release() resolves the callback's promise */
                return new Promise(res => {
                    locks.request(PREFIX + id, { ifAvailable: true }, lock => {
                        if (!lock) { res(false); return null }
                        return new Promise(letGo => { mine.set(id, letGo); res(true) })
                    }).catch(e => { console.warn('[tabs] lock refused:', e); res(true) })
                })
            }
            if (how === 'channel') {
                let taken = false
                ch.postMessage({ ask: id })
                await listen(wait, m => { if (m.have === id) taken = true })
                if (taken) return false
            }
            mine.set(id, () => { })
            return true
        },
        release(id) {
            const letGo = mine.get(id)
            mine.delete(id)
            letGo?.()
        },
        /** Held here. */
        holds: id => mine.has(id),
        async others() {
            if (how === 'locks') {
                const q = await locks.query()
                return new Set((q.held || []).map(l => l.name).filter(n => n?.startsWith(PREFIX)).map(n => n.slice(PREFIX.length)).filter(id => !mine.has(id)))
            }
            if (how === 'channel') {
                const out = new Set(), tag = Math.random().toString(36).slice(2)
                ch.postMessage({ who: tag })
                await listen(wait, m => { if (m.to === tag) for (const id of m.holding || []) out.add(id) })
                return out
            }
            return new Set()
        },
    }
}
