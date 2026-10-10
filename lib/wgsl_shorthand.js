// WGSL shorthand token expander — optional companion to tinywebgpu.js (D-007).
// The core never rewrites user WGSL; opt in by handing it a `defines` table:
//
//   import { defines, TOKENS, SHORT_TOKENS } from './WGSL_SHORTHAND.js';
//   G.defines = defines();                       // long tokens + constants only (safe set)
//   G.defines = defines(TOKENS, SHORT_TOKENS);   // full legacy set incl. one-letter aliases
//   G.defines = defines({ RAY: 'MyRayStruct', ...TOKENS });   // custom map
//
// `G.defines` is tinywebgpu's own whole-word, longest-token-first expander, applied to every
// shader it compiles (schema WGSL included). It replaced the older `G.pre` function hook, which
// did the same job from outside the library; `shorthand()` below still returns that function for
// anyone composing their own preprocessor, but `defines()` is the one to hand the toolkit.
//
// One constraint the table format imposes: a REPLACEMENT may not contain a comma, because commas
// separate entries. None of the tokens here do; check yours if you extend the map.

export const TOKENS = {
  FLOAT: 'f32', INT: 'i32',
  VEC2: 'vec2<f32>', VEC3: 'vec3<f32>', VEC4: 'vec4<f32>',
  MAT4: 'mat4x4<f32>',
  PI: '3.14159265359', TAU: '6.28318530718', EPS: '1e-5',
};

// One-letter aliases collide easily with user identifiers (F for Fresnel, U, PI...).
// They are deliberately NOT part of the default set — opt in explicitly.
export const SHORT_TOKENS = {
  F: 'f32', V: 'vec2<f32>', W: 'vec3<f32>', X: 'vec4<f32>',
  I: 'i32', U: 'u32', U3: 'vec3<u32>',
};

/** The map as a tinywebgpu `defines` string: `TOKEN replacement` entries, comma separated. */
export const defines = (...maps) =>
  Object.entries(Object.assign({}, ...(maps.length ? maps : [TOKENS])))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/** The same map as a standalone `(src) => src` rewriter, for composing your own preprocessor. */
export const shorthand = (...maps) => {
  const map = Object.assign({}, ...(maps.length ? maps : [TOKENS]));
  const esc = k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // longest key first so e.g. U3 wins over U
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(?:${keys.map(esc).join('|')})\\b`, 'g');
  return src => src.replace(re, t => map[t]);
};
