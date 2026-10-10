/* THIS PART NOT MANAGED BY AI.  THIS SECTION WRITTEN BY MATTHIJS  */
// NOTHING IN THIS FILE MAY BE CHANGED BY AI OR OTHER AUTONOMOUS TOOLS //
/*
                                                                             
88        88  888888888888  88  88           88  888888888888  8b        d8  
88        88       88       88  88           88       88        Y8,    ,8P   
88        88       88       88  88           88       88         Y8,  ,8P    
88        88       88       88  88           88       88          "8aa8"     
88        88       88       88  88           88       88           `88'      
88        88       88       88  88           88       88            88       
Y8a.    .a8P       88       88  88           88       88            88       
 `"Y8888Y"'        88       88  88888888888  88       88            88       
                                                                             
*/
export function UTILITY(
    s, { abs, max, min, round, floor, sqrt, cos, sin, tan, acos, asin, atan, atan2, sign, PI } = Math, RA = PI / 180,
    M = (a, b) => a.map(b),

    /*
    
            Array.prototype.fmp = function (callback) {
                let l = this.length, r = new Array(l);
                for (let i = 0; i < l; i++) r[i] = callback(this[i], i);
                return r
            }
    
    
    */
    L = (N, f) => M([...Array(N).keys()], f),
    // Loop through all elements of array or object and execute F
    C = (a, b = 0, c = 0) => L(a, i => b + i * c),  // create arrays with prefilled values C(3)=[0,0,0]  C(3,2)=[2,2,2]  C(4,4,10) [4,14,24,34]
    // SEED GENERATOR
    S = A => { s = Uint32Array.from([9, 7, 5, 3]), M([..."THANKS PITER" + A.toString()], c => R(s[3] ^= c.charCodeAt() * 23205)) },
    // PITERS RANDOM FUNCTION   R(
    R = (a = 1, b = 0) => { let n = 5, t = 3; return b + (a - b) * (t = s[3], s[3] = s[2], s[2] = s[1], s[1] = n = s[0], t ^= t << 11, s[0] ^= (t ^ t >>> 8) ^ (n >>> 19), s[0] / 2 ** 32) },
    Ri = (...a) => R(...a) | 0,   // integer          
    // recursive  split        
    X = (a, b = ",") => !!b ? M(a.split(b[0]), x => X(x, b.slice(1))) : a,   // 
    //
    A = (a, f) => M(Object.values(a), f),
    O = (a, b) => Object.assign(a, b),
    //
    Y = (s, c, f, t = {}) => (s.split(c).map(e => { t[e[0]] = f(e.substring(1)) }), t),  // splits text S in segments using c , putting it into struct t  eg  U.Y(sourcestring, "@", f => new W.P(VTX, SU + f), PR)
    // SELECT RANDOM FROM LIST l        
    P = l => l[R(l.length) | 0],
    // RARITY RANDOM   : RR[10,1,.2,3]  returns random index of this array, weighted with the number in the array.  so here, 0 will be returned most of the times and 2 is very rare
    RR = (a, e = M(a, (a => e => a += e)(0)), c = R(max(...e))) => e.findIndex(a => a > c),
    // RARITY generator: RV([1,99],[3,20.2],"rare,often")  -> returns 20.2 with  99% chance, returns 3 with 1% chance.
    ra = (k, b = "\n#define ", c = "%") => k.replaceAll(c, b),
    wh = (t, s) => { t.width = s.w; t.height = s.h },
    // scale screen:  Q.a=aspect ratio; Q.s determines size, when set.   Otherwise screen dimensions



    a2h = (a) => M([...a.flat()], e => floor(min(e * 255, 255)).toString(16).padStart(2, 0)).join(""),   // array (rgb or rgba) to hex  and hex 2 arrayalso works for rgba
    h2a = (n, t = 255) => M(n.match(/[a-f0-9]{2}/gi) || [], n => parseInt(n, 16) / t),   // hex to array

    RC = (rarity, values, descriptions, frequency = [1], combos = RR(frequency) + 1, i = 100, choice) => {
        rarity = Array.isArray(rarity) ? rarity : M(values, _ => 1);
        descriptions = (X(descriptions).length > 1) ? descriptions : descriptions + "," + M(values, (_, i) => i).join(",")
        while (i-- && (choice = [... new Set(L(combos, _ => RR(rarity)))].sort()).length != combos);
        let r = { n: X(descriptions)[0], values, rarity, descriptions, m: frequency.length }
        r.set = c => { r.v = M(c, i => values[i]), r.i = c, r.t = M(c, i => X(descriptions)[i + 1]).join(',') }
        r.get = _ => r.m == 0 ? r.v[0] : P(r.v)
        r.set(choice)
        return r
    },


    D = document,
    W = window,
    GU = Q => (new URLSearchParams(W.location.search).forEach((v, k) => Q[k] = v || 1), Q),
    q = k => D.querySelector(`#` + k),
    AE = (a, b, d) => a.addEventListener(b, d),
    e = a => D.createElement(a),
    Sv = (fn, h, l = e('a')) => { l.download = fn; l.href = h; l.click() },




    /*
        context: "webgl2" or "2d"
        parentelement: id of parent element to append the canvas to. If not set, the canvas will be appended to the body.


    */
    CC = (parentElement, context = true, zpos = 0, params = {}) => {
        let canvas = e('canvas'), ctx = canvas.getContext(context, params)   //  createelement canvas
        //canvas.style.cssText = 'position:absolute;top:0;left:0;z-index:' + zpos;        
        canvas.style.cssText = 'position: absolute; z-index: 1; height:100%;width:100%; object-fit: contain;top:0;left:0;z-index:' + zpos;
        q(parentElement).appendChild(canvas);

        ctx.Sc = (Q, t = W.innerWidth, u = W.innerHeight, a = Q.a = +Q.a || t / u) => {
            Q.w = floor((Q.s * 1) ? Q.s * min(a, 1) : min(t, u * a)); Q.h = floor(Q.w / a);
            wh(canvas, Q);
            wh(ctx.canvas, Q);
        }
        return ctx;
    },



    now = _ => performance.now(),
    startTime = now(), diffTime = startTime,
    tick = a => (console.log(`${((now() - startTime) / 1000).toFixed(2)}  [+${((now() - diffTime) / 1000).toFixed(2)}] ${a}`), diffTime = now()),
    timelast = startTime, fpsavg = 20.,
    FPS = (dn, a = "") => {
        let timedelta = dn - timelast, fps
        if (timedelta != 0) {
            timelast = dn;
            fps = 1000 / timedelta;
            fpsavg = (fpsavg * 99 + fps) / 100 || 0;
            D.title = `${(fps).toFixed(1)} (${(fpsavg).toFixed(1)}) ${a}`
        }
    },
    //===================================================================================================================================================================
    V = (x = 0, y = 0, z = 0) => {                                                               // VECTOR
        let t,
            add = (v, c = 1) => V(x + v.x * c, y + v.y * c, z + v.z * c),                           // ADD, multiply + add ( add(x,-1) = subtract
            M = s => s?.x == undefined ? V(x * s, y * s, z * s) : V(x * s.x, y * s.y, z * s.z),      //Multiply
            dot = v => x * v.x + y * v.y + z * v.z,                                                 // dot product
            cx = v => V(y * v.z - z * v.y, z * v.x - x * v.z, x * v.y - y * v.x),                      // cross product
            // get spherical data  (theta, phi, radius = t,p,r)
            gs = _ => (t = L(), { r: t, t: t == 0 ? 0 : atan2(x, y) / RA, p: t == 0 ? 0 : acos(max(-1, min(1, z / t))) / RA }),
            // set spherical
            ss = (s, t = sin(s.p * RA) * s.r) => (V(t * sin(s.t * RA), t * cos(s.t * RA), cos(s.p * RA) * s.r)),       // set spherical
            L = _ => sqrt(x ** 2 + y ** 2 + z ** 2),                                                                                                     // length
            N = _ => (t = L(), t == 0 ? V() : V(x / t, y / t, z / t)),  // normalize
            norm = N,
            mid = (B, C = null) => C == null ? V(x, y, z).add(B).M(0.5) : V(x, y, z).add(B).add(C).M(1 / 3),          // midpoint          
            a = _ => [x, y, z],                // array
            rot = (angle, direction = V(0, 0, 1), origin = V(0, 0, 0)) => (  // rotate the vector around a point
                angle *= RA,
                t = V(x, y, z).add(origin, -1),
                direction = direction.N(),
                t.M(Math.cos(angle))
                    .add(direction.cx(t).M(Math.sin(angle)))
                    .add(direction.M(direction.dot(t)).M(1 - Math.cos(angle))).add(origin)

            )

        return { x, y, z, add, dot, cx, M, gs, ss, L, N, mid, norm, a, rot }
    },
    //===================================================================================================================================================================
    // TRANSFORMATION MATRIX STUFF
    o4 = [0, 0, 0, 0], _flat = (...a) => [...a].flat(),
    T = (s = _flat(1, o4, 1, o4, 1, o4, 1), t,) => {
        let r = { F: s, Target: V(), Up: V(), Pos: V() }
        return r = {
            ...r,
            copy: (tn = T()) => (tn.F = [...r.F], tn.Target = r.Target, tn.Up = r.Up, tn.Pos = r.Pos, tn),
            Xx: _ => V(r.F[0], r.F[4], r.F[8]),
            Yx: _ => V(r.F[1], r.F[5], r.F[9]),
            Zx: _ => V(r.F[2], r.F[6], r.F[10]),
            // Lookat: eye , target Up
            La: (eye, tgt, up = V(0, 0, 1), zX = eye.add(tgt, -1).N(), xX = up.cx(zX).N(), yX = zX.cx(xX).N()) => (
                r.Target = tgt, r.Up = up, r.Pos = eye,
                r.F = [xX.x, yX.x, zX.x, 0, xX.y, yX.y, zX.y, 0, xX.z, yX.z, zX.z, 0, xX.dot(eye), -yX.dot(eye), -zX.dot(eye), 1], r),
            P: (fov, ar, near, far, f = 1. / tan(fov * RA / 2), ri = 1 / (near - far)) => (r.F = [f / ar, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * ri, -1, 0, 0, far * near * ri * 2, 0], r),
            O: (w, h, d) => (r.F = _flat(2 / w, 0, 0, 0, 0, 2 / h, 0, 0, 0, 0, 2 / d, 0, 0, 0, 0, 1), r),
            La_inv: (eye, tgt, up = V(0, 0, 1)) => {
                let zX = eye.add(tgt, -1).N(),
                    xX = up.cx(zX).N(),
                    yX = zX.cx(xX).N();
                return T([
                    xX.x, xX.y, xX.z, 0,
                    yX.x, yX.y, yX.z, 0,
                    zX.x, zX.y, zX.z, 0,
                    -(xX.dot(eye)), -(yX.dot(eye)), -(zX.dot(eye)), 1
                ]);

            },
            P_inv: ({ fov, ar, near, far } = r.projParams) => {
                const f = 1 / Math.tan(fov * RA / 2),
                    ri = 1 / (2 * far * near),
                    nf = 1 / (near - far);
                return T([
                    ar / f, 0, 0, 0,
                    0, 1 / f, 0, 0,
                    0, 0, 0, (near - far) / (2 * far * near),
                    0, 0, -1, (far + near) / (2 * far * near)
                ]);
            },

            M: (t, a = T()) => (L(4, i => L(4, (j, s = 0) => { L(4, k => { s += r.F[k * 4 + i] * t.F[j * 4 + k] }); a.F[j * 4 + i] = s })), a),
            // multiply
            Mv: (v, s = 1, [x, y, z, W] = L(4, i => v.x * r.F[i] + v.y * r.F[i + 4] + v.z * r.F[i + 8] + s * r.F[i + 12])) => ((W != 1 && W != 0) ? (x /= W, y /= W, z /= W) : 0, V(x, y, z)),
            // inverse
            
            ROT: (v, angle, s = sin(angle), c = cos(angle), t = 1 - c) => (v.L() === 0) ? T() : (v = v.N(), T([t * v.x * v.x + c, t * v.x * v.y - v.z * s, t * v.x * v.z + v.y * s, 0, t * v.x * v.y + v.z * s, t * v.y * v.y + c, t * v.y * v.z - v.x * s, 0, t * v.x * v.z - v.y * s, t * v.y * v.z + v.x * s, t * v.z * v.z + c, 0, 0, 0, 0, 1])),
            rotateView: (t = 0, a = 0, e = 0) => { let v = T().ROT(r.Yx(), t), M = T().ROT(r.Xx(), a), d = T().ROT(r.Zx(), e), x = r.Pos.add(r.Target, -1); x = v.Mv(x), x = M.Mv(x), x = d.Mv(x); let g = r.Target.add(x), O = r.Yx(); return O = v.Mv(O), O = M.Mv(O), O = d.Mv(O), T().La(g, r.Target, O) },

        }
    }) {

    S(0);
    //===================================================================================================================================================================   
    return { A, L, M, X, O, Y, S, R, RR, P, D, W, q, AE, e, ra, wh, a2h, h2a, RC, Ri, V, T, Sv, tick, FPS, GU, now, CC, C }
}

/*
                                                            
  ,ad8888ba,    88888888ba   88888888ba   88  888888888888  
 d8"'    `"8b   88      "8b  88      "8b  88       88       
d8'        `8b  88      ,8P  88      ,8P  88       88       
88          88  88aaaaaa8P'  88aaaaaa8P'  88       88       
88          88  88""""88'    88""""""8b,  88       88       
Y8,        ,8P  88    `8b    88      `8b  88       88       
 Y8a.    .a8P   88     `8b   88      a8P  88       88       
  `"Y8888Y"'    88      `8b  88888888P"   88       88       
                                                            
    ORBIT CONTROLS USAGE:
    • LEFT MOUSE BUTTON + DRAG: Orbit camera around target
    • LEFT MOUSE + CTRL + DRAG: Roll camera around view axis
    • MIDDLE MOUSE BUTTON + DRAG: Pan camera (move both position and target)
    • MOUSE WHEEL: Zoom in/out (move camera closer/farther from target)
    • MOUSE WHEEL + CTRL: Adjust field of view (FOV)
                                                            
*/

export function ORBIT({ AE, V, T }, { canvas, camera, config, onUpdate = () => { }, onSync = () => { }, onVisibilityUpdate = () => { } }) {
    // THIS SECTION GENERATED BY Claude
    // Pure camera controller - no UI dependencies, uses callbacks for external communication

    const RAD = Math.PI / 180, { abs, cos, sin, atan2, sqrt, min, max } = Math;

    // Complete camera update - syncs view->config, updates matrices, calls callbacks
    const update = () => {
        if (!camera?.view) return;

        // Sync view matrix to config values
        const { Pos, Target } = camera.view, dir = Pos.add(Target, -1);
        const azimuth = (atan2(dir.y, dir.x) / RAD + 360) % 360;
        const elevation = max(0, min(180, 90 - atan2(dir.z, sqrt(dir.x * dir.x + dir.y * dir.y)) / RAD));
        const distance = dir.L();

        // Update config and notify if changed
        let changed = false;
        if (abs(config.azimuth - azimuth) > 0.1) { config.azimuth = azimuth; changed = true; }
        if (abs(config.elevation - elevation) > 0.1) { config.elevation = elevation; changed = true; }
        if (abs(config.distance - distance) > 0.01) { config.distance = distance; changed = true; }

        if (changed || config.camtype === 0) onSync(['azimuth', 'elevation', 'distance', 'FOV']);

        // Update camera matrices
        config.camtype === 0 ?
            camera.projection = T().P(config.FOV, config.a, .01, 1000) :
            camera.orthogonal = T().O(config.dimensions, config.dimensions, 1000);

        // Notify visibility changes
        const persp = config.camtype == 0, showDoF = persp && config.mode != 0;
        onVisibilityUpdate({
            dimensions: !persp,
            FOV: persp,
            focallength: showDoF,
            aperture: showDoF
        });

        onUpdate();
    };

    // Sync config to view matrix  
    const syncToView = () => {
        if (!camera?.view) return;
        const { Target } = camera.view;
        const az = config.azimuth * RAD, el = (90 - config.elevation) * RAD, c = cos(el);
        camera.view = T().La(Target.add(V(config.distance * c * cos(az), config.distance * c * sin(az), config.distance * sin(el))), Target, V(0, 0, 1));
        update();
    };

    // Mouse handling
    let mouse = { pos: V(), down: false, button: null };
    AE(canvas, 'mousedown', e => mouse = { down: true, button: e.button, pos: V(e.clientX, e.clientY) });
    AE(canvas, 'mouseup', e => {
        mouse.down = false;
        if (V(e.clientX, e.clientY).add(mouse.pos, -1).L() > 2) canvas.addEventListener('contextmenu', e => e.preventDefault(), { once: true });
    });

    AE(canvas, 'mousemove', e => {
        if (!mouse.down) return;
        let np = V(e.clientX, e.clientY), dp = np.add(mouse.pos, -1);
        let { Pos, Target, Up } = camera.view, speed = 0.0005, distance = Pos.add(Target, -1).L();

        if (mouse.button === 0) {
            if (e.ctrlKey) { camera.view = camera.view.rotateView(0, 0, dp.x * speed); mouse.pos = np; update(); return; }
            Pos = Pos.rot(-dp.x, Up, Target).rot(-dp.y, camera.view.Xx(), Target);
        } else if (mouse.button === 1) {
            let moveX = camera.view.Xx().M(dp.x * speed * distance), moveY = camera.view.Yx().M(dp.y * speed * distance);
            Pos = Pos.add(moveX).add(moveY); Target = Target.add(moveX).add(moveY);
        }
        camera.view = T().La(Pos, Target, Up); mouse.pos = np; update();
    });

    AE(canvas, 'wheel', e => {
        e.preventDefault();
        let { Pos, Target, Up } = camera.view;
        if (!e.ctrlKey) {
            config.FOV *= 1 + e.deltaY / 1000;
            camera.projection.P(config.FOV, config.a, .01, 4000);
            onSync(['FOV']);
        } else {
            Pos = Pos.add(Pos.add(Target, -1).M(e.deltaY / 1000));
        }
        camera.view = T().La(Pos, Target, Up); update();
    });

    return { update, syncToView }; // Clean API for external initialization
}

//===================================================================================================================================================================

/*
                                                                          
 ad88888ba   8b           d8   ,ad8888ba,   88           88  88888888ba   
d8"     "8b  `8b         d8'  d8"'    `"8b  88           88  88      "8b  
Y8,           `8b       d8'  d8'            88           88  88      ,8P  
`Y8aaaaa,      `8b     d8'   88             88           88  88aaaaaa8P'  
  `"""""8b,     `8b   d8'    88      88888  88           88  88""""""8b,  
        `8b      `8b d8'     Y8,        88  88           88  88      `8b  
Y8a     a8P       `888'       Y8a.    .a88  88           88  88      a8P  
 "Y88888P"         `8'         `"Y88888P"   88888888888  88  88888888P"   
                                                                          
                                                                          
*/


export let SVGLIB = ({ q, L, Sv }) => {
    let S = {}, create = x => document.createElementNS("http://www.w3.org/2000/svg", x),
        svg = create("svg"),
        att = (x, y, z) => x.setAttribute(y, z),
        atx = (p, y) => { for (let z in y) att(p, z, y[z]) },
        app = x => S.current.appendChild(x),
        metadata = create('metadata')

    S.app = app;
    S.svg = svg;
    S.atx = atx;
    S.attach = a => q(a).appendChild(svg),
        S.clear = _ => { while (svg.firstChild) svg.removeChild(svg.firstChild) },
        S.current = svg,   // for grouping; elements are added to 'current'.     can be set to a group to add to group instead

        S.group = (set = {}, g = create('g')) => (atx(g, set), g),  // create group

        S.init = (w, h, w1 = 1000, h1 = 1000) => {
            //  svg.style.width = w + 'px'; svg.style.height = h + 'px';
            atx(svg, { viewBox: `0 0 ${w1} ${h1}`, width: `${w1}mm`, height: `${h1}mm` })
            svg.appendChild(metadata)
        },
        S.add = (x, set = {}, child = {}) => { let p, y, def; for (y in x) { p = create(y); atx(p, x[y]); atx(p, set); app(p); } return p; },
        S.appendText = t => { var template = create('template'); template.innerHTML = t; svg.append(template.childNodes[0]) },
        // draw a polyline --------------------------------------------------------------------------------------------------
        S.polyline = (closed = false, set = {}, points = [], svgpoints = []) => ({
            points,
            add: (...x) => { svgpoints.push(...x); L(x.length / 2, i => points.push({ x: x[i * 2], y: x[i * 2 + 1] })) },
            draw: () => { let p = create(closed ? "polygon" : "polyline"); atx(p, { points: svgpoints.join(",") }); atx(p, set); app(p) }
        }),
        // draw path --------------------------------------------------------------------------------------------------
        S.path = (s = {}, list = "", r) => (r = {
            set: s, add: (p, x) => list += p + x.map(num => parseFloat(num.toFixed(4))).join(","),
            moveTo: (...x) => r.add("M", x),
            lineTo: (...x) => r.add("L", x),
            bezTo: (...x) => r.add("T", x),
            bezToR: (...x) => r.add("t", x),
            draw: (s = r.set) => { let p = create("path"); atx(p, { d: list }); atx(p, s); app(p); }
        }),
        S.text = (x, y, txt, set = { fill: 'black', 'font-size': 310 }) => {
            let t = create('text');
            atx(t, { x: x, y: y, ...set });
            t.textContent = txt;
            app(t);
        },
        S.save = f => Sv(f, "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<?xml version="1.0" standalone="no"?>\r\n' + new XMLSerializer().serializeToString(svg)))

    return S
}

/*
                                 
  ,ad8888ba,   88        88  88  
 d8"'    `"8b  88        88  88  
d8'            88        88  88  
88             88        88  88  
88      88888  88        88  88  
Y8,        88  88        88  88  
 Y8a.    .a88  Y8a.    .a8P  88  
  `"Y88888P"    `"Y8888Y"'   88  
                                 
                                 
*/
//===================================================================================================================================================================

export let GUIold = async (file, guidata, prog) => {
    const { GUI: datGUI } = await import('../../LIBRARIES/WEBGL/dat.gui.module.js');
    return fetch(file)
        .then(response => response.json())
        .catch(error => console.error('Error:', error))
        .then(json => {
            let c = new datGUI({ load: json, preset: 'Default' });
            let addc = (a, b, q = guidata, oc = _ => { }) => { b.map(v => a.add(q, ...v).onChange(oc).updateDisplay()); a.open() }
            c.remember(guidata);
            prog(c, addc)
            return c
        })
}



export let GUI = async (file, guidata, prog) => {
    const { GUI: datGUI } = await import('../../LIBRARIES/WEBGL/dat.gui.module.js');
    let c, addc = (a, b, q = guidata, oc = _ => { }) => {
        b.map(v => a.add(q, ...v).onChange(oc).updateDisplay());
        a.open();
    };

    try {
        const response = await fetch(file);
        if (!response.ok) throw new Error('File not found');
        const json = await response.json();
        c = new datGUI({ load: json, preset: 'Default' });
    } catch (error) {
        // console.error('Error:', error);
        c = new datGUI(); // Initialize without presets if error
    }

    c.remember(guidata);
    prog(c, addc);
    return c;
}


/* EXAMPLE

GUI("settings.json", Q, (C, addc) => {
    addc(C, [
        [['title']],
        ['blur', 0, 20,],
        ['load', 0],

    ], Q.LoadImage)
})

*/


/*
                                                     
88888888ba,         db    888888888888    db         
88      `"8b       d88b        88        d88b        
88        `8b     d8'`8b       88       d8'`8b       
88         88    d8'  `8b      88      d8'  `8b      
88         88   d8YaaaaY8b     88     d8YaaaaY8b     
88         8P  d8""""""""8b    88    d8""""""""8b    
88      .a8P  d8'        `8b   88   d8'        `8b   
88888888Y"'  d8'          `8b  88  d8'          `8b  
                                                     
                                                     
*/

export let DATA = (C, { h2a, A, R }, r = { p: {}, c: {}, r: {}, uniforms: {}, onchange: _ => { } }) => (
    r.add = (name, value, ...p) => {
        r.uniforms[name] = value;
        r.p[name] = [...p]   // params: min, max , steps. can be used for ranomization for instance
        r.c[name] = C.add(r.uniforms, name, ...p).onChange(r.onchange)
    },
    r.addr = (name, value, ...p) => {
        r.add(name, value, ...p);
        r.r[name] = true
    },

    r.addColor = (name, value) => {
        let _name = "_" + name;
        r.uniforms[_name] = value;
        r.uniforms[name] = h2a(r.uniforms[_name] + "FF")
        r.c[name] = C.addColor(r.uniforms, _name,).onChange(_ => {
            r.uniforms[name] = h2a(r.uniforms[_name] + "FF")
            console.log(r.uniforms)
            r.onchange()
        })

    },
    r.rnd = _ => {
        for (let a in r.p) {
            if (r.r[a]) {
                r.uniforms[a] = R(r.p[a][0], r.p[a][1])

                console.log("Randomizing ", a, r.p[a][0], r.p[a][1], " : ", r.uniforms[a])
            }
        }

    },
    r)
    ,


    loadcontrols = _ => {  // call this when controls have been loaded. 
        let T = DATA(controls)
        T.onchange = _ => console.log(T.uniforms)
        T.add("test2", 10, 0, 100, 1)
    }













/*
                                                                                                                                  
88888888ba   88888888ba     ,ad8888ba,         db         88888888ba,      ,ad8888ba,         db         ad88888ba  888888888888  
88      "8b  88      "8b   d8"'    `"8b       d88b        88      `"8b    d8"'    `"8b       d88b       d8"     "8b      88       
88      ,8P  88      ,8P  d8'        `8b     d8'`8b       88        `8b  d8'                d8'`8b      Y8,              88       
88aaaaaa8P'  88aaaaaa8P'  88          88    d8'  `8b      88         88  88                d8'  `8b     `Y8aaaaa,        88       
88""""""8b,  88""""88'    88          88   d8YaaaaY8b     88         88  88               d8YaaaaY8b      `"""""8b,      88       
88      `8b  88    `8b    Y8,        ,8P  d8""""""""8b    88         8P  Y8,             d8""""""""8b           `8b      88       
88      a8P  88     `8b    Y8a.    .a8P  d8'        `8b   88      .a8P    Y8a.    .a8P  d8'        `8b  Y8a     a8P      88       
88888888P"   88      `8b    `"Y8888Y"'  d8'          `8b  88888888Y"'      `"Y8888Y"'  d8'          `8b  "Y88888P"       88       
                                                                                                                                  
                                                                                                                                  
*/









//===================================================================================================================================================================
// used tro send data between windows
export let BROADCAST = (cname, callback) => {
    let channel = new BroadcastChannel(cname)
    let send = d => channel.postMessage(d)
    channel.onmessage = e => callback(e.data)
    return { send }
}
/*
            B=BROADCAST("a",q=>{
                Q={...Q,...q};
                UPDATE()
            }),


              UPDATE = _ => {                
                if (Q.master) B.send({ ...Q, master: false, slave: true })
                ctx.fillStyle = Q.c1;
                ctx.fillRect(0, 0, Q.w, Q.h);

            }
            */

export let COMMS = (cname, callback) => {
    let findMessage = "Hello?"
    let findAck = "Hello!"
    let R = {
        channel: new BroadcastChannel(cname),
        master: null, slave: null
    }
    R.send = d => {
        if (!R.slave && !R.master) {
            console.log("I AM YOUR MASTER")
            R.master = true
        }
        R.channel.postMessage(d)
    }
    R.find = _ => {
        R.slave = false
        R.send(findMessage)
    }
    R.channel.onmessage = e => {
        if (!R.slave && !R.master) {
            R.slave = true
            console.log("YES MASTER I AM YOUR SLAVE")
            if (e.data == findMessage) R.send(findAck)
        }
        callback(e.data)
    }
    return R
}









/*
                                             
88b           d88  88  88888888ba,    88     
888b         d888  88  88      `"8b   88     
88`8b       d8'88  88  88        `8b  88     
88 `8b     d8' 88  88  88         88  88     
88  `8b   d8'  88  88  88         88  88     
88   `8b d8'   88  88  88         8P  88     
88    `888'    88  88  88      .a8P   88     
88     `8'     88  88  88888888Y"'    88     
                                             
                                             
*/




//===================================================================================================================================================================
/// MIDI
// attach to an existing dat.gui if needed.

export let MIDI = (gui = null, cb = _ => _) => navigator.requestMIDIAccess?.().then(
    m => {
        if (gui) {
            gui.sx = null; gui.mX = []; gui.cx = {}
            const A = (C, p = '', n) => {
                C.__controllers.forEach(c => {
                    n = c.__li.className;
                    c.bl = n.includes`bool`;
                    gui.cx[p + c.property] = c;
                    (n.includes`slider` || c.bl) && c.__li.querySelector`.property-name`?.addEventListener('mousedown', () => gui.sx = c.property);
                });
                Object.keys(C.__folders).forEach(f => A(C.__folders[f], `${p}${f}.`))
            }
            A(gui);
            window.addEventListener('mouseup', () => gui.sx = null);
        }
        m.inputs.forEach(i => i.onmidimessage = (e, d = [...e.data], ctrl) => {
            if (gui?.sx) gui.mX[d[1]] = gui.sx;
            ctrl = gui?.cx[gui.mX[d[1]]];
            ctrl?.setValue(ctrl.bl ? d[2] > 64 : (d[2] / 127) * (ctrl.__max - ctrl.__min) + ctrl.__min);
            cb(d);
        })
    }
);
;
